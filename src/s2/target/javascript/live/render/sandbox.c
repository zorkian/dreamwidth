/*
 * sandbox.c
 *
 * Bounded credential-free local stock renderer execution.
 *
 * Authors:
 *      Dreamwidth contributors
 *
 * Copyright (c) 2026 by Dreamwidth Studios, LLC.
 *
 * This program is free software; you may redistribute it and/or modify it under
 * the same terms as Perl itself. For a copy of the license, please reference
 * 'perldoc perlartistic' or 'perldoc perlgpl'.
 *
 */

#define _GNU_SOURCE
#include <errno.h>
#include <stddef.h>
#include <stdio.h>
#include <unistd.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>

#if defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#else
#error Unsupported sandbox architecture
#endif
#define DENY(number) \
    BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, number, 0, 1), \
    BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ERRNO | EPERM)

/* Installs an inherited kernel network denial before exec. Node's separate
 * permission mode restricts filesystem reads, writes, subprocesses and addons.
 * This is a trusted-stock renderer, not arbitrary untrusted JavaScript hosting.
 */
int main(int argc, char **argv) {
    if (argc < 2 || argv[1][0] != '/') return 125;
    /* Only the three explicit parent pipes remain. In particular, no inherited
     * database, network or configuration file descriptor can bypass permissions.
     * Supported local Linux kernel has close_range; absence fails closed.
     */
    if (syscall(__NR_close_range, 3u, ~0u, 0u)) return 125;
    struct sock_filter filter[] = {
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, arch)),
        BPF_JUMP(BPF_JMP | BPF_JEQ | BPF_K, EXPECTED_ARCH, 1, 0),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD | BPF_W | BPF_ABS, offsetof(struct seccomp_data, nr)),
#ifdef __x86_64__
        /* Reject the x32 ABI, which uses different syscall numbers. */
        BPF_JUMP(BPF_JMP | BPF_JSET | BPF_K, 0x40000000, 0, 1),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_KILL_PROCESS),
#endif
        DENY(__NR_socket), DENY(__NR_socketpair), DENY(__NR_connect),
        DENY(__NR_bind), DENY(__NR_listen), DENY(__NR_accept),
        DENY(__NR_accept4), DENY(__NR_sendto), DENY(__NR_sendmsg),
        DENY(__NR_sendmmsg), DENY(__NR_recvfrom), DENY(__NR_recvmsg),
        DENY(__NR_recvmmsg),
        /* io_uring networking must not bypass the ordinary socket calls. */
        DENY(__NR_io_uring_setup),
        BPF_STMT(BPF_RET | BPF_K, SECCOMP_RET_ALLOW),
    };
    struct sock_fprog program = {
        .len = (unsigned short)(sizeof(filter) / sizeof(filter[0])), .filter = filter
    };
    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) ||
        prctl(PR_SET_SECCOMP, SECCOMP_MODE_FILTER, &program)) {
        fputs("Renderer isolation unavailable\n", stderr);
        return 125;
    }
    execv(argv[1], &argv[1]);
    fputs("Renderer start failed\n", stderr);
    return 125;
}

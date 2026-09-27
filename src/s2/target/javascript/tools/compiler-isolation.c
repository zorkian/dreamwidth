/*
 * compiler-isolation.c
 *
 * Read-only, network-free execution of the local S2 compiler.
 *
 * Authors:
 *      Dreamwidth contributors
 *
 * Copyright (c) 2026 by Dreamwidth Studios, LLC.
 *
 * This program is free software; you may redistribute it and/or modify it under
 * the same terms as Perl itself. For a copy of the license, please reference
 * 'perldoc perlartistic' or 'perldoc perlgpl'.
 */
#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/landlock.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <linux/audit.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/syscall.h>
#include <unistd.h>

/* Ubuntu's build headers predate ABI 2/3; these are the kernel UAPI bits.
 * Runtime ABI >= 3 is mandatory, so old kernels still fail closed. */
#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif

#define DENY(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,n,0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|1)
static int allow(int rules, const char *path, uint64_t access) {
    int file=open(path,O_PATH|O_CLOEXEC);
    if(file<0)return -1;
    struct landlock_path_beneath_attr rule={.allowed_access=access,.parent_fd=file};
    int result=syscall(__NR_landlock_add_rule,rules,LANDLOCK_RULE_PATH_BENEATH,&rule,0);
    close(file);return result;
}
int main(int argc,char **argv) {
    /* Administrative paths: Perl, script, compiler module directory, S2.pm.
     * Source candidates arrive ONLY on stdin, never as filesystem paths. */
    if(argc!=5)return 125;
    for(int i=1;i<argc;i++)if(argv[i][0]!='/')return 125;
    if(syscall(__NR_close_range,3u,~0u,0u))return 125;
    int abi=syscall(__NR_landlock_create_ruleset,NULL,0,LANDLOCK_CREATE_RULESET_VERSION);
    if(abi<3)return 125;
    uint64_t read=LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_READ_DIR;
    uint64_t all=read|LANDLOCK_ACCESS_FS_EXECUTE|LANDLOCK_ACCESS_FS_WRITE_FILE|
        LANDLOCK_ACCESS_FS_REMOVE_DIR|LANDLOCK_ACCESS_FS_REMOVE_FILE|
        LANDLOCK_ACCESS_FS_MAKE_CHAR|LANDLOCK_ACCESS_FS_MAKE_DIR|
        LANDLOCK_ACCESS_FS_MAKE_REG|LANDLOCK_ACCESS_FS_MAKE_SOCK|
        LANDLOCK_ACCESS_FS_MAKE_FIFO|LANDLOCK_ACCESS_FS_MAKE_BLOCK|
        LANDLOCK_ACCESS_FS_MAKE_SYM|LANDLOCK_ACCESS_FS_REFER|LANDLOCK_ACCESS_FS_TRUNCATE;
    struct landlock_ruleset_attr attr={.handled_access_fs=all};
    int rules=syscall(__NR_landlock_create_ruleset,&attr,sizeof(attr),0);
    if(rules<0)return 125;
    if(allow(rules,"/usr/lib",read|LANDLOCK_ACCESS_FS_EXECUTE)||
       allow(rules,"/lib",read|LANDLOCK_ACCESS_FS_EXECUTE)||
       allow(rules,"/lib64",read|LANDLOCK_ACCESS_FS_EXECUTE)||
       allow(rules,"/usr/share/perl",read)||allow(rules,"/usr/share/perl5",read)||
       allow(rules,argv[1],LANDLOCK_ACCESS_FS_READ_FILE|LANDLOCK_ACCESS_FS_EXECUTE)||
       allow(rules,argv[2],LANDLOCK_ACCESS_FS_READ_FILE)||
       allow(rules,argv[3],read)||allow(rules,argv[4],LANDLOCK_ACCESS_FS_READ_FILE))return 125;
    if(prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0)||
       syscall(__NR_landlock_restrict_self,rules,0))return 125;
    close(rules);
    struct sock_filter filters[]={
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,AUDIT_ARCH_X86_64,1,0),
        BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
        BPF_JUMP(BPF_JMP|BPF_JSET|BPF_K,0x40000000,0,1),
        BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
        DENY(__NR_socket),DENY(__NR_socketpair),DENY(__NR_connect),
        DENY(__NR_io_uring_setup),DENY(__NR_fork),DENY(__NR_vfork),DENY(__NR_clone),
#ifdef __NR_clone3
        DENY(__NR_clone3),
#endif
        DENY(__NR_ptrace),DENY(__NR_process_vm_readv),DENY(__NR_process_vm_writev),
        BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)};
    struct sock_fprog filter={.len=sizeof(filters)/sizeof(filters[0]),.filter=filters};
    if(prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&filter))return 125;
    struct rlimit memory={.rlim_cur=1073741824,.rlim_max=1073741824};
    struct rlimit cpu={.rlim_cur=60,.rlim_max=60};
    if(setrlimit(RLIMIT_AS,&memory)||setrlimit(RLIMIT_CPU,&cpu))return 125;
    char *args[]={argv[1],argv[2],NULL};
    char *env[]={"LANG=C","LC_ALL=C","TZ=UTC","PERL_HASH_SEED=0","PERL_PERTURB_KEYS=0",NULL};
    execve(argv[1],args,env);
    return 125;
}

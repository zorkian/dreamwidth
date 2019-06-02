FROM ubuntu:18.04

LABEL maintainer="Mark Smith <mark@dreamwidth.org>"

ARG branch=develop

ENV DEBIAN_FRONTEND noninteractive

RUN apt update; \
    apt install -y git cpanminus libdatetime-timezone-perl tzdata make gcc unzip \
        libgtop2-dev libxml2-dev libssl-dev libexpat1-dev libgmp-dev \
        libapreq2-dev libapache2-mod-perl2-dev libapache2-request-perl \
        perlmagick libdbd-mysql-perl; \
    echo "Etc/UTC" > /etc/timezone; dpkg-reconfigure -f noninteractive tzdata

ENV LJHOME /dw

RUN git clone https://github.com/dreamwidth/dw-free.git dw; \
    cd dw; \
    git checkout ${branch}; \
    cd ext; \
    git clone https://github.com/dreamwidth/dw-nonfree.git dw-nonfree; \
    cd dw-nonfree; \
    git checkout ${branch}; \
    cd ../..; \
    bin/checkconfig.pl --install --no=database; \
    bin/checkconfig.pl --no=database

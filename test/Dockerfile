FROM alpine:3.7

WORKDIR /tmp

RUN apk --no-cache add --update bash

RUN apk --no-cache add --update --virtual build-dep git \
    && git clone https://github.com/bats-core/bats-core.git \
    && apk del build-dep \
    && mkdir -p /opt/bats \
    && cp -R bats-core/* /opt/bats \
    && rm -rf /tmp/* \
    && ln -s /opt/bats/libexec/bats /usr/sbin/bats

WORKDIR /code

ENTRYPOINT ["bats"]

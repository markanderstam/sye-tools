FROM alpine:3.7

RUN apk --no-cache add --update bash

RUN addgroup bats && adduser -H -D -s /bin/bash -G bats bats

RUN apk --no-cache add --update --virtual build-dep git \
    && git clone https://github.com/bats-core/bats-core.git /tmp/bats \
    && apk del build-dep \
    && ./tmp/bats/install.sh /usr/local \
    && rm -rf /tmp/*

USER bats
WORKDIR /code

ENTRYPOINT ["bats"]

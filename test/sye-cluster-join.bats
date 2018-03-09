#!/usr/bin/env bats

source "${BATS_TEST_DIRNAME}/../sye-cluster-join.sh" >/dev/null 2>/dev/null

function random_str {
    local length=${1:-16}
    cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w ${length} | head -n 1
}


@test "Extract sye-environment.tar.gz" {
    local CONFDIR=/tmp/$(random_str)
    local FILE=${BATS_TEST_DIRNAME}/sye-environment.tar.gz

    run extractConfigurationFile
    [ "$status" -eq 0 ]

    [[ -d "${CONFDIR}/instance-data" ]]
    [[ -d "${CONFDIR}/keys" ]]
    [ $(stat -c %a ${CONFDIR}) -eq 600 ]
    [[ -f "${CONFDIR}/machine.json" ]]
    [[ -f "${CONFDIR}/global.json" ]]

    rm -rf ${CONFDIR}
}

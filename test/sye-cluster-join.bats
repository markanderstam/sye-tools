#!/usr/bin/env bats

source "${BATS_TEST_DIRNAME}/../sye-cluster-join.sh" >/dev/null 2>/dev/null

function random_str {
    local length=${1:-16}
    cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w ${length} | head -n 1
}


@test "Write configuration file" {
    local testfile=${BATS_TMPDIR}/machine.json
    local contents='{"test": "config write"}'

    run writeConfigurationFile $(dirname ${testfile}) $(basename ${testfile}) "${contents}"
    [[ -f ${testfile} ]]

    run cat ${testfile}
    [ "$status" -eq 0 ]
    [ "$output" = "${contents}" ]

    run rm ${testfile}
    [ "$status" -eq 0 ]
}


@test "Write configuration file with non-existent path" {
    local filepath=${BATS_TMPDIR}/$(random_str)

    [[ ! -d ${filepath} ]]

    run writeConfigurationFile ${filepath} machine.json ""
    [ "$status" -eq 1 ]
    [[ "$output" == *"No such file or directory" ]]
}


@test "Extract configuration files" {
    local CONFDIR=${BATS_TMPDIR}/$(random_str)
    local FILE=${BATS_TEST_DIRNAME}/test-config.tar.gz

    run extractConfigurationFile
    [ "$status" -eq 0 ]

    [[ -d "${CONFDIR}/instance-data" ]]
    [[ -d "${CONFDIR}/keys" ]]
    [ $(stat -c %a ${CONFDIR}) -eq 600 ]
    [[ -f "${CONFDIR}/machine.json" ]]
    [[ -f "${CONFDIR}/global.json" ]]

    rm -rf ${CONFDIR}
}


@test "Extract configuration files from missing archive" {
    local CONFDIR=${BATS_TMPDIR}/$(random_str)
    local FILE=${BATS_TEST_DIRNAME}/missing.tar.gz

    [[ ! -f ${FILE} ]]

    run extractConfigurationFile
    [ "$status" -eq 1 ]
    [ "$output" = "Configuration file ${FILE} missing, exiting" ]
    [[ ! -d ${CONFDIR} ]]
}


@test "Validate machine tags" {
    local failure=0
    local valid_tags=(
        "tag1"
        "tag-2"
        "test_3"
        "test-123"
        "t1,t2,t3,t4"
    )
    for tags in ${valid_tags[@]}; do
        run validateMachineTags ${tags}
        if [ "$status" -ne 0 ]; then
            echo "$output"
            failure+=1
        fi
    done

    local boundary_cases=(
        "1,1"
        "_,_"
        ",1"
        ",-"
        ",,1"
        $(random_str 1000)
        $(printf '_%.0s' {1..1000})
        $(printf '\-%.0s' {1..1000})
        $(printf '1%.0s' {1..1000})
    )

    for tags in ${boundary_cases[@]}; do
        run validateMachineTags ${tags}
        if [ "$status" -ne 0 ]; then
            echo "$output"
            failure+=1
        fi
    done

    [ "${failure}" -eq 0 ]

    local invalid_tags=(
        ","
        ",,"
        "¨"
    )

    for tags in ${invalid_tags[@]}; do
        run validateMachineTags ${tags}
        [ "$status" -eq 1 ]
        [ "$output" = "Invalid machine tags: ${tags}" ]
    done
}

#!/usr/bin/env bats

source "${BATS_TEST_DIRNAME}/../sye-cluster-join.sh" >/dev/null 2>/dev/null

function random_str {
    local length=${1:-16}
    cat /dev/urandom | tr -dc 'a-zA-Z0-9' | fold -w ${length} | head -n 1
}


function item_in_array {
  local e match="$1"
  shift
  for e; do [[ "$e" == "$match" ]] && return 0; done
  return 1
}


@test "Set global variables from args should validate that values are set" {
    local value_parameters=(
        "-f" "--file"
        "-mcv" "--mc-version"
        "-mp" "--management-port"
        "-mtp" "--management-tls-port"
        "-mn" "--machine-name"
        "-l" "--location"
        "-mz" "--machine-zone"
        "-mt" "--machine-tags"
    )
    for parameter in ${value_parameters[@]}; do
        run setGlobalVariablesFromArgs ${parameter} ""
        [ "$status" -eq 1 ]
        run setGlobalVariablesFromArgs ${parameter} "dummy"
        [ "$status" -eq 0 ]
    done

    local set_parameters=(
        "--single"
        "--management"
    )
    local parameter=
    for parameter in ${set_parameters[@]}; do
        run setGlobalVariablesFromArgs ${parameter} ""
        echo "$status ${output}"
        [ "$status" -eq 0 ]
    done
}


@test "Set global variables defaults should set expected variables" {
    local failures=0
    local defaulted_globals=(
        "CONFDIR"
        "FILE"
        "MANAGEMENT_PORT"
        "MANAGEMENT_TLS_PORT"
        "MACHINE_NAME"
        "LOCATION"
        "MACHINE_REGION"
        "MACHINE_TAGS"
    )
    # Make sure we do not already have globals set.
    local var=
    for var in ${defaulted_globals[@]}; do
        unset ${var}
    done

    setGlobalVariablesDefaults

    local vars=$(compgen -v)
    for var in ${defaulted_globals[@]}; do
        run item_in_array ${var} ${vars[@]}
        if [ "$status" -eq 1 ]; then
            failures+=1
            echo "${var} did not get set"
        fi
    done

    [ "${failures}" -eq 0 ]
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
    local failures=0
    local valid_tags=(
        "tag1"
        "tag-2"
        "test_3"
        "test-123"
        "t1,t2,t3,t4"
    )
    local tags=
    for tags in ${valid_tags[@]}; do
        run validateMachineTags ${tags}
        if [ "$status" -ne 0 ]; then
            echo "$output"
            failures+=1
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
            failures+=1
        fi
    done

    [ "${failures}" -eq 0 ]

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

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


@test "_setGlobalVariablesDefaults Set global variables defaults should set expected variables" {
    local failures=0
    local defaulted_globals=(
        "CONFDIR=/etc/sye"
        "FILE=./sye-environment.tar.gz"
        "MANAGEMENT_PORT=81"
        "MANAGEMENT_TLS_PORT=4433"
        "MACHINE_NAME=$(hostname --fqdn)"
        "LOCATION=Unknown"
        "MACHINE_REGION=default"
        "MACHINE_TAGS="
        "PUBLIC_INTERFACES="
    )

    _setGlobalVariablesDefaults

    local var_default var default
    for var_default in ${defaulted_globals[@]}; do
        var=${var_default/=*/}
        default=${var_default/*=/}
        if [ "${!var}" != "${default}" ]; then
            failures+=1
            echo "Expected ${var} to be '${default}', set to '${!var}'"
        fi
    done

    [ "${failures}" -eq 0 ]
}


@test "_setGlobalVariablesFromArgs Set global variables from args should validate that values are set" {
    local value_parameters=(
        "-f" "--file"
        "-mcv" "--mc-version"
        "-mp" "--management-port"
        "-mtp" "--management-tls-port"
        "-mn" "--machine-name"
        "-l" "--location"
        "-mz" "--machine-zone"
        "-mt" "--machine-tags"
        "--public-ipv4"
    )
    for parameter in ${value_parameters[@]}; do
        run _setGlobalVariablesFromArgs ${parameter} ""
        [ "$status" -eq 1 ]
        run _setGlobalVariablesFromArgs ${parameter} "dummy"
        [ "$status" -eq 0 ]
    done

    local set_parameters=(
        "--single"
        "--management"
    )
    local parameter=
    for parameter in ${set_parameters[@]}; do
        run _setGlobalVariablesFromArgs ${parameter} ""
        echo "$status ${output}"
        [ "$status" -eq 0 ]
    done
}


@test "buildMachineJsonConfig Build machine.json with location, machineName" {
    local location="location"
    local machine_name="name"
    local expected_config='{"location":"location","machineName":"name"}'

    run buildMachineJsonConfig ${location} ${machine_name}
    echo "${output}"

    [ "$status" -eq 0 ]
    [ "$output" = "${expected_config}" ]
}


@test "buildMachineJsonConfig Build machine.json with interfaces" {
    local location="location"
    local machine_name="name"
    local expected_interfaces='"interfaces":{"eth0":{"publicIpv4":"1.2.3.4"},"eth1":{"publicIpv4":"2.3.4.5"}}'

    run buildMachineJsonConfig ${location} ${machine_name} "eth0=1.2.3.4 eth1=2.3.4.5"
    [ "$status" -eq 0 ]
    [ "$output" = '{"location":"location","machineName":"name",'${expected_interfaces}'}' ]

    run buildMachineJsonConfig ${location} ${machine_name} ""
    [ "$status" -eq 0 ]
    [ "$output" = '{"location":"location","machineName":"name"}' ]
}


@test "extractConfigurationFile Extract configuration files" {
    local conf_dir=${BATS_TMPDIR}/$(random_str)
    local file=${BATS_TEST_DIRNAME}/test-config.tar.gz

    run extractConfigurationFile ${file} ${conf_dir}
    [ "$status" -eq 0 ]

    [[ -d "${conf_dir}/instance-data" ]]
    [[ -d "${conf_dir}/keys" ]]
    [ $(stat -c %a ${conf_dir}) -eq 600 ]
    [[ -f "${conf_dir}/global.json" ]]

    rm -rf ${conf_dir}
}


@test "extractConfigurationFile Extract configuration files from missing archive" {
    local conf_dir=${BATS_TMPDIR}/$(random_str)
    local file=${BATS_TEST_DIRNAME}/missing.tar.gz

    [[ ! -f ${file} ]]

    run extractConfigurationFile ${file} ${conf_dir}
    [ "$status" -eq 1 ]
    [ "$output" = "Configuration file ${file} missing, exiting" ]
    [[ ! -d ${conf_dir} ]]
}


@test "getPublicIpv4Interfaces Get list of public ipv4 interfaces from string" {
    run getPublicIpv4Interfaces "eth0=1.2.3.4,br0=5.4.3.2"

    echo "${status} ${output}"
    [ "$status" -eq 0 ]
    [ "$output" = "eth0=1.2.3.4 br0=5.4.3.2" ]
}


@test "registryPrefixFromUrl Should strip protocol from registry URL" {
    local REGISTRY_URL=
    local protocols=("http" "https")
    local uris=("my.registry.url" "registry.url:5000" "docker.io/test")

    for protocol in ${protocols[@]}; do
        for uri in ${uris[@]}; do
            REGISTRY_URL="${protocol}://${uri}"
            run registryPrefixFromUrl

            [ "$status" -eq 0 ]
            echo "output: ${output}"
            [ "$output" = "${uri}" ]
        done
    done
}


@test "validateMachineTags Validate machine tags" {
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


@test "writeConfigurationFile Write configuration file" {
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


@test "writeConfigurationFile Write configuration file with non-existent path" {
    local filepath=${BATS_TMPDIR}/$(random_str)

    [[ ! -d ${filepath} ]]

    run writeConfigurationFile ${filepath} machine.json ""
    [ "$status" -eq 1 ]
    [[ "$output" == *"No such file or directory" ]]
}

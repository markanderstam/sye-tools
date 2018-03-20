#!/usr/bin/env bats

load helpers/test_helper
load helpers/mocks/stub

source "${BATS_TEST_DIRNAME}/../sye-cluster-join.sh" >/dev/null 2>/dev/null


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
    [ $(stat -c %a ${conf_dir}) -eq 0700 ]
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


@test "getEcrLogin should exit if aws-cli missing" {
    run getEcrLogin "https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com" "key id" "secret key"

    [ "$status" -eq 1 ]
    [[ "${output}" =~ "Please install awscli. Aborting." ]]
}


@test "getEcrLogin should login to ECR" {
    local ecr_url="https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com"
    local ecr_user="AWS"
    local ecr_pass=$(random_str)

    stub aws "ecr get-login --no-include-email : echo 'docker login -u ${ecr_user} -p ${ecr_pass}'"

    run getEcrLogin "https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com" "key id" "secret key"
    echo "${output}"
    [ "$status" -eq 0 ]
    [ "$output" = "docker login -u ${ecr_user} -p ${ecr_pass}" ]

    unstub aws
}


@test "getPublicIpv4Interfaces Get list of public ipv4 interfaces from string" {
    run getPublicIpv4Interfaces "eth0=1.2.3.4,br0=5.4.3.2"

    [ "$status" -eq 0 ]
    [ "$output" = "eth0=1.2.3.4 br0=5.4.3.2" ]
}


@test "imageReleaseRevision should call curl with correct args" {
    local service="influxdb"
    local service_version="r28.6"
    local release_manifest="$(get_service_docker_manifest "${service}" "${service_version}")"

    unset getTokenFromDockerHub
    stub getTokenFromDockerHub ": echo 'token'"

    curl_args_1=("-s" "-H" "Accept: application/json" "-H" "Authorization: Bearer token" "https://registry.hub.docker.com/v2/netidev/release/manifests/r29.1")
    curl_args_2=("-k" "-u" "user:pass" "-H" "Accept: application/vnd.docker.distribution.manifest.v1+json" "https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com/v2/release/manifests/r29.1")
    curl_args_3=("-s" "https://dockerregistry.neti.systems:5000/v2/ott/release/manifests/r29.1")
    curl_args_4=("-s" "-k" "-u" "username:password" "https://dockerregistry.neti.systems:5000/v2/ott/release/manifests/r29.1")
    stub curl \
        "${curl_args_1} : echo '${release_manifest}'" \
        "${curl_args_2} : echo '${release_manifest}'" \
        "${curl_args_3} : echo '${release_manifest}'" \
        "${curl_args_4} : echo '${release_manifest}'"

    run imageReleaseRevision "https://docker.io/netidev" "" "" "${service}" "r29.1"
    [ "$status" -eq 0 ] && [ "$output" = "${service_version}" ]

    run imageReleaseRevision "https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com" "user" "pass" "${service}" "r29.1"
    [ "$status" -eq 0 ] && [ "$output" = "${service_version}" ]

    run imageReleaseRevision "https://dockerregistry.neti.systems:5000/ott" "" "" "${service}" "r29.1"
    [ "$status" -eq 0 ] && [ "$output" = "${service_version}" ]

    run imageReleaseRevision "https://dockerregistry.neti.systems:5000/ott" "username" "password" "${service}" "r29.1"
    [ "$status" -eq 0 ] && [ "$output" = "${service_version}" ]

    unstub getTokenFromDockerHub
    unstub curl
}


@test "imageReleaseRevision should get latest tag from docker hub" {
    local service="influxdb"
    local service_version="r28.6"
    local release_manifest="$(get_service_docker_manifest "${service}" "${service_version}")"

    unset getTokenFromDockerHub
    stub getTokenFromDockerHub ": echo 'docker-hub-token'"
    stub curl ": echo '${release_manifest}'"

    run imageReleaseRevision "https://docker.io/netidev" "" "" "${service}" "r29.1"
    [ "$status" -eq 0 ]
    [ "$output" = "${service_version}" ]

    unstub getTokenFromDockerHub
    unstub curl
}


@test "imageReleaseRevision should get latest tag from local registry" {
    local repository_url="https://dockerregistry.neti.systems:5000/ott"
    local service="ad-playlist-router"
    local service_version="r24.8"
    local release_manifest="$(get_service_docker_manifest "${service}" "${service_version}")"

    stub curl \
        ": echo '${release_manifest}'" \
        ": echo '${release_manifest}'"

    run imageReleaseRevision "${repository_url}" "" "" "${service}" "r29.1"
    [ "$status" -eq 0 ]
    [ "$output" = "${service_version}" ]

    run imageReleaseRevision "${repository_url}" "user" "passwd" "${service}" "r29.1"
    [ "$status" -eq 0 ]
    [ "$output" = "${service_version}" ]

    unstub curl
}


@test "imageReleaseRevision should fail to get tag for last service in manifest label list" {
    local service="ad-playlist-router"
    local service_version="r24.8"
    local release_manifest="$(get_service_docker_manifest "${service}" "${service_version}" "last")"

    stub curl ": echo '${release_manifest}'"

    run imageReleaseRevision "https://dockerregistry.neti.systems:5000/ott" "" "" "${service}" "r29.1"
    [ "$status" -eq 0 ]
    [ "$output" != "${service_version}" ]
    [ "$output" = "${service_version}\\" ]

    unstub curl
}


@test "imageReleaseRevision should get latest tag from ECR" {
    local service="ad-playlist-router"
    local service_version="r24.8"
    local release_manifest="$(get_service_docker_manifest "${service}" "${service_version}")"

    stub curl ": echo '${release_manifest}'"

    run imageReleaseRevision "https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com" "user" "passwd" "${service}" "r29.1"
    [ "$status" -eq 0 ]
    [ "$output" = "${service_version}" ]

    unstub curl
}


@test "joinElements Join array items with different delimiter" {
    local delimiter=
    for delimiter in "," "-" " " "'" "å"; do
        run joinElements "${delimiter}" "this" "is" "a" "test"
        [ "$status" -eq 0 ]
        [ "$output" = "this${delimiter}is${delimiter}a${delimiter}test" ]
    done
}


@test "joinElements Join array items containing spaces and delimiters" {
    run joinElements "," "space should" "not" "affect"
    [ "$status" -eq 0 ]
    [ "$output" = "space should,not,affect" ]

    run joinElements "," "delimiter,should be" "allowed"
    [ "$status" -eq 0 ]
    [ "$output" = "delimiter,should be,allowed" ]

    run joinElements "," ""
    [ "$status" -eq 0 ]
    [ "$output" = "" ]

    run joinElements "," "" ""
    [ "$status" -eq 0 ]
    [ "$output" = "," ]
}


@test "registryPrefixFromUrl Should strip protocol from registry URL" {
    local protocols=("http" "https")
    local uris=("my.registry.url" "registry.url:5000" "docker.io/test")

    for protocol in ${protocols[@]}; do
        for uri in ${uris[@]}; do
            run registryPrefixFromUrl "${protocol}://${uri}"

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


@test "dockerRegistryLogin should login to docker.io if url matches" {
    stub docker "login -u username --password-stdin : true "

    run dockerRegistryLogin "docker.io" "username" "password"

    [ "$status" -eq 0 ]
    [ "$output" = "Log in to Docker Cloud registry" ]

    unstub docker
}


@test "dockerRegistryLogin should login to ECR if url matches" {
    local ecr_url="https://aws_account_id.dkr.ecr.us-west-1.amazonaws.com"
    local ecr_user="AWS"
    local ecr_pass=$(random_str)

    unset getEcrLogin
    stub getEcrLogin ": echo 'docker login -u ${ecr_user} -p ${ecr_pass}'"
    stub docker "login -u ${ecr_user} --password-stdin ${ecr_url} : true"

    run dockerRegistryLogin "${ecr_url}" "aws key id" "aws secret key"

    [ "$status" -eq 0 ]
    [ "$output" = "Log in to Amazon ECR container registry" ]

    unstub getEcrLogin
    unstub docker
}


@test "dockerRegistryLogin should login to to private registry" {
    stub docker "login -u username --password-stdin : true https://localhost:5000"

    run dockerRegistryLogin "https://localhost:5000" "username" "password"

    [ "$status" -eq 0 ]
    [ "$output" = "Log in to private container registry" ]

    unstub docker
}


@test "dockerRegistryLogin should not login if password or username not set" {
    stub docker

    run dockerRegistryLogin "https://localhost:5000"
    [ "$status" -eq 0 ]

    unstub docker
}

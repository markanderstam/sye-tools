#!/usr/bin/env bash

set -o errexit -o pipefail

declare CONFDIR=
declare FILE=

function errcho() {
    1>&2 echo $@
}

function _main {
    _setGlobalVariablesDefaults
    _setGlobalVariablesFromArgs $@

    extractConfigurationFile "${FILE}" "${CONFDIR}"
    waitForCertsReloaded
}

function _setGlobalVariablesDefaults() {
    CONFDIR=${CONFDIR:-"/etc/sye"}
    # Set default values
}

function _setGlobalVariablesFromArgs() {
    while [ $# -gt 0 ]; do
        case "$1" in
            -h|--help)
                _usage
                ;;
            -f|--file)
                validateFlag --file $2
                FILE=$2
                shift
                ;;
            *)
                errcho "Unknown option $1"
                exit 1
                ;;
        esac
        shift
    done
}

function _usage() {
    cat << EOF
description: Update certificates from SYE configuration file
usage: sudo ./sye-cluster-install-certs.sh --file <config-file>

options:
-f, --file <filename>                          configuration filename, default ./sye-environment.tar.gz
-h, --help                                     show brief help
EOF
    exit 0
}

function validateFlag() {
    if [ -z $2 ]; then
        echo 'No value provided for '$1
        exit 1
    fi
}

function extractConfigurationFile() {
    local file=$1
    local confDir=$2
    if [[ ! -r ${file} ]]; then
        errcho "Configuration file ${file} missing, exiting"
        exit 1
    fi
    tar -xzf ${file} -C ${confDir} -o keys
}

function waitForCertsReloaded() {
    local machineControllerName=$(docker ps --filter 'name=machine-controller-' --format '{{.Names}}')
    if ! [[ ${machineControllerName} ]]; then
        errcho "Cannot find the machine controller container"
        exit 1
    fi
    echo "*** --------------------------------------------- ***"
    echo "*** Waiting for certificate rotation to complete: ***"
    echo "*** --------------------------------------------- ***"
    until ! (docker logs -f ${machineControllerName} --since 5s | sed '/CA Certificate Update Complete/ q0'); do
        sleep 1
    done
}

if [ "$0" == "$BASH_SOURCE" ]; then
    _main $@
fi

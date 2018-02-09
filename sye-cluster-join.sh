#!/bin/bash

set -e

CONFDIR="/etc/sye"

function usage() {
    cat << EOF
description: Add this machine to a cluster
usage: sudo ./cluster-join.sh [options][--single <interface-name>|--management <interface-name>][--help]

options:
-f, --file <filename>                          configuration filename, default ./sye-environment.tar.gz
-mcv, --mc-version <revision>                  start a specific version of the machine-controller
-mp, --management-port <port>                  start playout-management listening on a port, default 81
-mtp, --management-tls-port <port>             start playout-management listening on a TLS port, default 4433
-mn, --machine-name <machine-name>             name for this machine, defaults to hostname
-l, --location <location>                      location for this machine, default "Unknown"
-mr, --machine-region <machine-region>         region for this machine, default "default"
-mz, --machine-zone <machine-zone>             zone for this machine, default "default"
-mt, --machine-tags <machine-tags>             optional tags for this machine

--single <interface-name>                      start single-pitcher services listening on an interface
--management <interface-name>                  start management services listening on an interface
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

function validateMachineTags() {
    if ! [[ $1 =~ ^(^$)|([a-zA-Z0-9_-]+,)*([a-zA-Z0-9_-]+)$ ]]
    then
        echo 'Invalid machine tags: '$1
        exit 1
    fi
}

function extractConfigurationFile() {
    mkdir -p ${CONFDIR}/instance-data
    tar -xzf ${FILE} -C ${CONFDIR} -o
cat << EOF > ${CONFDIR}/machine.json
{"location":"${LOCATION}","machineName":"${MACHINE_NAME}"}
EOF
}

function imageReleaseRevision() {
    local image=$1
    local url

    if [[ ${registryUrl} =~ (.*)docker\.io(.*) ]]
    then
        # For Docker Cloud
        url=$(dockerRegistryApiUrlFromUrl $(echo ${registryUrl} | sed 's/docker.io/registry.hub.docker.com/g'))/release/manifests/${release}
        echo $(curl -s -H "Accept: application/json" -H "Authorization: Bearer $(getTokenFromDockerHub)" ${url} | grep -o ''"${image}"'=[a-zA-Z0-9\._-]*' | cut -d '=' -f2)
    elif [[ ${registryUrl} =~ (.*)amazonaws(.*) ]]
    then
        url=$(dockerRegistryApiUrlFromUrl ${registryUrl})/release/manifests/${release}
        echo $(curl -k -u ${registryUsername}:${registryPassword} -H "Accept: application/vnd.docker.distribution.manifest.v1+json" ${url} | grep -o ''"${image}"'=[a-zA-Z0-9\._-]*' | cut -d '=' -f2)
    else
        # For internal Docker registry
        url=$(dockerRegistryApiUrlFromUrl ${registryUrl})/release/manifests/${release}
        if [[ ${registryUsername} && ${registryPassword} ]]
        then
            echo $(curl -s -k -u ${registryUsername}:${registryPassword} ${url} | grep -o ''"${image}"'=[a-zA-Z0-9\._-]*' | cut -d '=' -f2)
        else
            echo $(curl -s ${url} | grep -o ''"${image}"'=[a-zA-Z0-9\._-]*' | cut -d '=' -f2)
        fi
    fi
}

function registryPrefixFromUrl() {
    echo $(echo ${registryUrl} | sed -e 's/^http:\/\///g' -e 's/^https:\/\///g')
}

function dockerRegistryApiUrlFromUrl() {
    local url=$1
    local proto=$(echo ${url} | grep :// | sed -e's,^\(.*://\).*,\1,g')
    local host=$(echo ${url/${proto}/})
    local pathName=$(echo ${host} | grep / | cut -d/ -f2-)
    if [[ ${pathName} ]]
    then
        echo $(echo ${proto}${host} | sed 's/'"${pathName}"'/v2\/'"${pathName}"'/g')
    else
        echo ${proto}${host}/v2
    fi
}

function getTokenFromDockerHub() {
    local repo=${registryUrl##*/}/release
    echo $(curl -s -u ${registryUsername}:${registryPassword} "https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull" | sed -e 's/^.*"token":"\([^"]*\)".*$/\1/')
}

while [ $# -gt 0 ]
do
    case "$1" in
        -h|--help)
            usage
            ;;
        -f|--file)
            validateFlag --file $2
            FILE=$2
            shift
            ;;
        -mcv|--mc-version)
            validateFlag --mc-version $2
            MACHINE_VERSION=$2
            shift
            ;;
        -mp|--management-port)
            validateFlag --management-port $2
            MANAGEMENT_PORT=$2
            shift
            ;;
        -mtp|--management-tls-port)
            validateFlag --management-tls-port $2
            MANAGEMENT_TLS_PORT=$2
            shift
            ;;
        -mn|--machine-name)
            validateFlag --machine-name $2
            MACHINE_NAME=$2
            shift
            ;;
        -l|--location)
            validateFlag --location $2
            LOCATION=$2
            shift
            ;;
        -mr|--machine-region)
            validateFlag --machine-region $2
            MACHINE_REGION=$2
            shift
            ;;
        -mz|--machine-zone)
            validateFlag --machine-zone $2
            MACHINE_ZONE=$2
            shift
            ;;
        -mt|--machine-tags)
            validateFlag --machine-tags $2
            MACHINE_TAGS=$2
            shift
            ;;
        --single)
            SINGLE=$2
            shift
            ;;
        --management)
            MANAGEMENT=$2
            shift
            ;;
        *)
            echo "Unknown option $1"
            exit 1
            ;;
    esac
    shift
done

# Set default values
FILE=${FILE:-"./sye-environment.tar.gz"}
MANAGEMENT_PORT=${MANAGEMENT_PORT:-"81"}
MANAGEMENT_TLS_PORT=${MANAGEMENT_TLS_PORT:-"4433"}
MACHINE_NAME=${MACHINE_NAME:-$(hostname --fqdn)}
LOCATION=${LOCATION:-"Unknown"}
MACHINE_REGION=${MACHINE_REGION:-"default"}
MACHINE_ZONE=${MACHINE_ZONE:-"default"}
MACHINE_TAGS=${MACHINE_TAGS:-""}

validateMachineTags $MACHINE_TAGS

if [[ ${SINGLE} && ${MANAGEMENT} ]]; then
    echo "Cannot be both single-server and management at the same time. Single-server includes management. Exiting."
    exit 1
fi

extractConfigurationFile

release=$( sed -n 's/.*"release": "\(.*\)".*/\1/p' ${CONFDIR}/global.json )
registryUrl=$( sed -n 's/.*"registryUrl": "\(.*\)".*/\1/p' ${CONFDIR}/global.json )
registryUsername=$( sed -n 's/.*"registryUsername": "\(.*\)".*/\1/p' ${CONFDIR}/global.json )
registryPassword=$( sed -n 's/.*"registryPassword": "\(.*\)".*/\1/p' ${CONFDIR}/global.json )

if [[ ${registryUrl} =~ (.*)docker\.io(.*) ]]
then
    echo 'Log in to Docker Cloud registry'
    docker login -u ${registryUsername} -p ${registryPassword}
elif [[ ${registryUrl} =~ (.*)amazonaws(.*) ]]
then
    echo 'Log in to Amazon ECR container registry'
    command -v aws >/dev/null 2>&1 || { echo "Please install awscli. Aborting." >&2; exit 1; }
    if [[ ${registryUsername} && ${registryPassword} ]]
    then
        export AWS_ACCESS_KEY_ID=$registryUsername
        export AWS_SECRET_ACCESS_KEY=$registryPassword
    fi
    export AWS_DEFAULT_REGION=$(echo $registryUrl | sed 's/.*ecr.\([a-zA-Z0-9-]*\).amazonaws.com.*/\1/')
    cmd="$(aws ecr get-login --no-include-email)"
    output=$cmd
    registryUsername=$(echo $output | sed 's/.*-u \([a-zA-Z0-9]*\).*/\1/')
    registryPassword=$(echo $output | sed 's/.*-p \([a-zA-Z0-9=]*\).*/\1/')
    docker login -u ${registryUsername} -p ${registryPassword} ${registryUrl}
else
    echo 'Log in to private container registry'
    if [[ ${registryUsername} && ${registryPassword} ]]
    then
        docker login -u ${registryUsername} -p ${registryPassword} ${registryUrl}
    fi
fi

mkdir -p /sharedData/timeshift
chown -R sye:sye /sharedData

echo "Starting machine-controller"

docker run -d \
    -e "SINGLE_SERVER_IF=${SINGLE}" \
    -e "BOOTSTRAP_IF=${MANAGEMENT}" \
    -e "CONTAINER_NAME=machine-controller-1" \
    -e "MEMORY_LIMIT=256" \
    -e "MACHINE_REGION=${MACHINE_REGION}" \
    -e "MACHINE_ZONE=${MACHINE_ZONE}" \
    -e "MACHINE_TAGS=${MACHINE_TAGS}" \
    -e "MANAGEMENT_PORT=${MANAGEMENT_PORT}" \
    -e "MANAGEMENT_TLS_PORT=${MANAGEMENT_TLS_PORT}" \
    -v /etc/sye:/etc/sye:rw \
    -v /var/lib/docker/volumes:/var/lib/docker/volumes:rw \
    -v /tmp/cores:/tmp/cores:rw \
    -v /var/run/docker.sock:/var/run/docker.sock \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/group:/etc/group:ro \
    --net=host \
    --log-driver=json-file \
    --log-opt max-size=20m \
    --log-opt max-file=10 \
    --memory 256M \
    --restart always \
    --name machine-controller-1 $(registryPrefixFromUrl)/machine-controller:${MACHINE_VERSION:-$(imageReleaseRevision "machine-controller")}

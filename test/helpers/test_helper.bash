#!/usr/bin/env bash


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


function get_service_docker_manifest {
    local service=$1
    local service_version=$2
    local position=$3
    local labels=("systems.neti.servicerevision.${service}=${service_version}")

    local dummy_label="systems.neti.servicerevision.dummyservice=r00.1"
    if [ "${position}" != "first" ]; then
        labels=("${dummy_label}" "${labels[@]}")
    fi
    if [ "${position}" != "last" ]; then
        labels+=("${dummy_label}")
    fi
    echo '{"history": [{"v1Compatibility": "{\"container_config\":{\"Cmd\":[\"/bin/sh -c #(nop)  LABEL '"${labels[@]}"'\"]}}"}]}'

}

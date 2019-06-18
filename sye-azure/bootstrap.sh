#!/bin/bash

set -e

# usage: bootstrap.sh [<cluster-join parameters>...]
echo PUBLIC_STORAGE_URL $PUBLIC_STORAGE_URL
echo ROLES $ROLES
echo URL $SYE_ENV_URL
echo STORAGE_DEVICE_NAME $STORAGE_DEVICE_NAME

echo Arguments "${@:1}"

passwd -d netinsight

curl -o /home/netinsight/.ssh/authorized_keys $PUBLIC_STORAGE_URL/authorized_keys
chown netinsight:netinsight /home/netinsight/.ssh/authorized_keys
chmod go-rwx /home/netinsight/.ssh/authorized_keys

if [[ $STORAGE_DEVICE_NAME ]]
then
    while file -L -s $STORAGE_DEVICE_NAME | grep -l "$STORAGE_DEVICE_NAME: cannot open" > /dev/null
    do
        echo Waiting for data volume to be attached
        sleep 5
    done
    if file -L -s $STORAGE_DEVICE_NAME | grep -l "$STORAGE_DEVICE_NAME: data" > /dev/null
    then
        echo Formatting data volume
        mkfs -t ext4 $STORAGE_DEVICE_NAME
    fi
    echo Mounting data volume
    mkdir -p /var/lib/docker/volumes
    UUID=`file -L -s $STORAGE_DEVICE_NAME | sed 's/.*UUID=\([0-9a-f-]*\) .*/\1/'`
    echo "UUID=$UUID /var/lib/docker/volumes ext4 defaults,barrier=0 0 2" >> /etc/fstab
    mount -a -v
fi

curl -fsSL https://download.docker.com/linux/ubuntu/gpg | apt-key add -
add-apt-repository \
   "deb [arch=amd64] https://download.docker.com/linux/ubuntu \
   $(lsb_release -cs) \
   stable"
apt-get update
apt-get install -y docker-ce
usermod -aG docker netinsight
useradd -M sye

if [[ $ROLES =~ (^|,)log($|,) ]]
then
    echo "Applying role log"
    # elasticsearch refuses to listen to external interface without this:
    sed '/^vm.max_map_count = /{h;s/=.*/= 262144/};${x;/^$/{s//vm.max_map_count = 262144/;H};x}' -i /etc/sysctl.conf
    sysctl -p
fi

if [[ $ROLES =~ (^|,)pitcher($|,) ]]
then
    echo "Applying role pitcher"
    echo "" >> /etc/sysctl.conf
    echo "net.core.wmem_max=20000000" >> /etc/sysctl.conf
    echo "net.core.rmem_max=20000000" >> /etc/sysctl.conf
    sysctl -p
fi

echo "Enabling core dumps to /tmp/cores"
# apport overwrites core_pattern settings so we have to remove it
sudo apt-get purge apport -y
mkdir /tmp/cores
chmod 777 /tmp/cores
echo "kernel.core_pattern=/tmp/cores/core" >> /etc/sysctl.d/cores.conf
echo "kernel.core_uses_pid=0" >> /etc/sysctl.d/cores.conf
sysctl -p
echo "d /tmp/cores 0777 - - - -" >> /etc/tmpfiles.d/cores.conf
echo "x /tmp/cores - - - - -" >> /etc/tmpfiles.d/cores.conf

echo "Setting TCP keepalive configuration"
echo "net.ipv4.tcp_keepalive_time=120" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_intvl=30" >> /etc/sysctl.conf
echo "net.ipv4.tcp_keepalive_probes=3" >> /etc/sysctl.conf
sysctl -p

mkdir /sharedData

curl -o sye-environment.tar.gz "$SYE_ENV_URL"
curl -O $PUBLIC_STORAGE_URL/sye-cluster-join.sh
chmod +x sye-cluster-join.sh
./sye-cluster-join.sh "${@:1}"
rm sye-environment.tar.gz

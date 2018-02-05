#!/bin/bash

set -e

# usage: bootstrap.sh [<cluster-join parameters>...]
# Run once when the instance is started fresh from an AMI
echo PUBLIC_STORAGE_URL $PUBLIC_STORAGE_URL
echo ROLES $ROLES
echo URL $SYE_ENV_URL
echo ATTACHED_STORAGE $ATTACHED_STORAGE
echo ELASTIC_FILE_SYSTEM_DNS $ELASTIC_FILE_SYSTEM_DNS

echo Arguments "${@:1}"

curl -o /home/netinsight/.ssh/authorized_keys $PUBLIC_STORAGE_URL/authorized_keys
chown netinsight:netinsight /home/netinsight/.ssh/authorized_keys
chmod go-rwx /home/netinsight/.ssh/authorized_keys

# if [ "$ATTACHED_STORAGE" == "true" ]
# then
#     while file -L -s /dev/sdb | grep -l '/dev/sdb: cannot open' > /dev/null
#     do
#         echo Waiting for data volume to be attached
#         sleep 5
#     done
#     if file -L -s /dev/sdb | grep -l '/dev/sdb: data' > /dev/null
#     then
#         echo Formatting data volume
#         mkfs -t ext4 /dev/sdb
#     fi
#     echo Mounting data volume
#     mkdir -p /var/lib/docker/volumes
#     UUID=`file -L -s /dev/sdb | sed 's/.*UUID=\([0-9a-f-]*\) .*/\1/'`
#     echo "UUID=$UUID /var/lib/docker/volumes ext4 defaults 0 2" >> /etc/fstab
#     mount -a
# fi

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
    echo "net.core.wmem_default=14700" >> /etc/sysctl.conf
    echo "net.core.wmem_max=147000" >> /etc/sysctl.conf
    echo "net.core.rmem_max=20000000" >> /etc/sysctl.conf
    echo "net.core.rmem_default=20000000" >> /etc/sysctl.conf
    sysctl -p
fi

mkdir /sharedData
# if [[ $ELASTIC_FILE_SYSTEM_DNS ]]
# then
#     mount -t nfs -o nfsvers=4.1,timeo=600,retrans=2 $ELASTIC_FILE_SYSTEM_DNS:/  /sharedData
# fi

curl -o sye-environment.tar.gz "$SYE_ENV_URL"
curl -O $PUBLIC_STORAGE_URL/sye-cluster-join.sh
chmod +x sye-cluster-join.sh
./sye-cluster-join.sh "${@:1}"
rm sye-environment.tar.gz

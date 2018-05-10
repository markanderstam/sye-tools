#!/bin/sh

set -e

# usage: bootstrap.sh [<cluster-join parameters>...]
echo BUCKET $BUCKET
echo ROLES $ROLES
echo URL $SYE_ENV_URL
echo EBS_DEVICE_NAME $EBS_DEVICE_NAME
echo EFS_DNS $EFS_DNS

echo Arguments "${@:1}"

aws s3 cp s3://$BUCKET/public/authorized_keys /home/ec2-user/.ssh/authorized_keys
chown ec2-user:ec2-user /home/ec2-user/.ssh/authorized_keys
chmod go-rwx /home/ec2-user/.ssh/authorized_keys

if [[ $EBS_DEVICE_NAME ]]
then
    while file -L -s $EBS_DEVICE_NAME | grep -l "$EBS_DEVICE_NAME: cannot open" > /dev/null
    do
        echo Waiting for data volume to be attached
        sleep 5
    done
    if file -L -s $EBS_DEVICE_NAME | grep -l "$EBS_DEVICE_NAME: data" > /dev/null
    then
        echo Formatting data volume
        mkfs -t ext4 $EBS_DEVICE_NAME
    fi
    echo Mounting data volume
    mkdir -p /var/lib/docker/volumes
    UUID=`file -L -s $EBS_DEVICE_NAME | sed 's/.*UUID=\([0-9a-f-]*\) .*/\1/'`
    echo "UUID=$UUID /var/lib/docker/volumes ext4 defaults 0 2" >> /etc/fstab
    mount -a -v
fi

yum -y update
# NOTE: skipping version 17.12.1ce with recursive unmount of root.
# Fixed in version 18.03.0-ce: https://github.com/moby/moby/pull/36237.
yum -y install --releasever=2017.09 docker-17.09.1ce-1.111.amzn1
usermod -aG docker ec2-user
service docker restart
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
if [[ $EFS_DNS ]]
then
    mount -t nfs -o nfsvers=4.1,timeo=600,retrans=2 $EFS_DNS:/  /sharedData
fi

curl -o sye-environment.tar.gz "$SYE_ENV_URL"
aws s3 cp s3://$BUCKET/public/sye-cluster-join.sh .
chmod +x sye-cluster-join.sh
./sye-cluster-join.sh "${@:1}"
rm sye-environment.tar.gz

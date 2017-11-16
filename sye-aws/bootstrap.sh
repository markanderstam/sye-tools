#!/bin/sh

set -e

# usage: bootstrap.sh [<cluster-join parameters>...]
# Run once when the instance is started fresh from an AMI
echo BUCKET $BUCKET
echo ROLES $ROLES
echo URL $SYE_ENV_URL
echo ATTACHED_STORAGE $ATTACHED_STORAGE

echo Arguments "${@:1}"

aws s3 cp s3://$BUCKET/public/authorized_keys /home/ec2-user/.ssh/authorized_keys
chown ec2-user:ec2-user /home/ec2-user/.ssh/authorized_keys
chmod go-rwx /home/ec2-user/.ssh/authorized_keys

if [ "$ATTACHED_STORAGE" == "true" ]
then
    while file -L -s /dev/sdb | grep -l '/dev/sdb: cannot open' > /dev/null
    do
        echo Waiting for data volume to be attached
        sleep 5
    done
    if file -L -s /dev/sdb | grep -l '/dev/sdb: data' > /dev/null
    then
        echo Formatting data volume
        mkfs -t ext4 /dev/sdb
    fi
    echo Mounting data volume
    mkdir -p /var/lib/docker/volumes
    UUID=`file -L -s /dev/sdb | sed 's/.*UUID=\([0-9a-f-]*\) .*/\1/'`
    echo "UUID=$UUID /var/lib/docker/volumes ext4 defaults 0 2" >> /etc/fstab
    mount -a
fi

yum -y update
yum -y install docker
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
    # TODO: Make it work on Amazon Linux
    echo "Applying role pitcher"
    echo "" >> /etc/sysctl.conf
    echo "net.core.wmem_default=14700" >> /etc/sysctl.conf
    echo "net.core.wmem_max=147000" >> /etc/sysctl.conf
    echo "net.core.rmem_max=20000000" >> /etc/sysctl.conf
    echo "net.core.rmem_default=20000000" >> /etc/sysctl.conf
    sysctl -p

fi

curl -o sye-environment.tar.gz "$SYE_ENV_URL"
aws s3 cp s3://$BUCKET/public/sye-cluster-join.sh .
chmod +x sye-cluster-join.sh
./sye-cluster-join.sh "${@:1}"
rm sye-environment.tar.gz

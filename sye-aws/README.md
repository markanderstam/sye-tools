# Sye-aws

The sye-aws command can be used to setup a multi-region sye backend on Amazon AWS.
All machines will communicate with each other over IPv6.

## Installation

Make sure that you have [nodejs](https://nodejs.org) installed. Install the sye-tools package with

    npm install -g @netinsight/sye-tools

## Create the cluster

Create the sye-environment.tar.gz describing the cluster using the sye-command:

    sye cluster-create --release r23.175 --internal-ipv6 https://docker.io/netisye my-cluster-etcd1.example.com  my-cluster-etcd2.example.com my-cluster-etcd3.example.com

This creates a file called sye-environment.tar.gz in the current directory.
This file contains all secret credentials for the cluster and should be protected
from unauthorized access.

Create the IAM Role and the s3-bucket:

    sye-aws cluster-create my-cluster.example.com

Now you need to add the following files to the s3-bucket my-cluster.example.com:

- sye-environment.tar.gz in the private/ folder
- sye-cluster-join.sh in the public/ folder
- sye-cluster-leave.sh in the public/ folder
- authorized_keys in the public/ folder

## Add regions

Setup new regions for the cluster:

    ./sye-aws region-add my-cluster.example.com eu-central-1
    ./sye-aws region-add my-cluster.example.com eu-west-2

## Add machines

    ./sye-aws machine-add my-cluster.example.com eu-central-1 --availability-zone a --instance-type t2.large --machine-name core1 --management
    ./sye-aws machine-add my-cluster.example.com eu-central-1 --availability-zone b --instance-type t2.large --machine-name core2
    ./sye-aws machine-add my-cluster.example.com eu-central-1 --availability-zone c --instance-type t2.large --machine-name core3
    ./sye-aws machine-add my-cluster.example.com eu-west-2 --instance-type t2.large --machine-name pitcher --role pitcher

    ./sye-aws cluster-show my-cluster.example.com

Now you should add DNS names for the etcd-machines:

- my-cluster-etcd1.example.com
- my-cluster-etcd2.example.com
- my-cluster-etcd3.example.com

The DNS-names should point to the public IPv6 addresses for the machines.

The system can now be managed by pointing your browser
to the private IP address of the machine named "core1", port 81.

# Shutting down a cluster

- Delete all ec2 instances
- Delete all VPCs
- Delete the IAM Role named "clusterId"-instance
- Delete the IAM Policy named "clusterId"-s3-read

Do NOT delete the s3-bucket if you want to use the same cluster-id again.
cluster-create can handle if the bucket already exists.

# sye aws

The sye aws command can be used to setup a multi-region sye backend on Amazon AWS.
All machines will communicate with each other over IPv6.

## Create the cluster

Create the sye-environment.tar.gz describing the cluster using the sye-command:

    sye cluster-create --release r23.175 --internal-ipv6 https://docker.io/netisye my-cluster-etcd1.example.com  my-cluster-etcd2.example.com my-cluster-etcd3.example.com

This creates a file called sye-environment.tar.gz in the current directory.
This file contains all secret credentials for the cluster and should be protected
from unauthorized access.

You also need a set of ssh-keys that shall be allowed to login to all machines.
These keys shall be specified in an authorized_keys file. See the man-page
for sshd for a specification of the authorized_keys file-format.

Create the IAM Role and the s3-bucket:

    sye aws cluster-create my-cluster.example.com ./sye-environment.tar.gz ./authorized_keys

## Add regions

Setup new regions for the cluster (start with the core region):

    sye aws region-add my-cluster.example.com eu-central-1
    sye aws region-add my-cluster.example.com eu-west-2

## Add machines

    sye aws machine-add my-cluster.example.com eu-central-1 --availability-zone a --instance-type t2.large --machine-name core1 --management
    sye aws machine-add my-cluster.example.com eu-central-1 --availability-zone b --instance-type t2.large --machine-name core2
    sye aws machine-add my-cluster.example.com eu-central-1 --availability-zone c --instance-type t2.large --machine-name core3
    sye aws machine-add my-cluster.example.com eu-west-2 --instance-type t2.large --machine-name pitcher --role pitcher

    sye aws cluster-show my-cluster.example.com

Now you should add DNS names for the etcd-machines:

- my-cluster-etcd1.example.com
- my-cluster-etcd2.example.com
- my-cluster-etcd3.example.com

The DNS-names should point to the public IPv6 addresses for the machines.

## Create DNS records

    sye aws dns-record-create my-cluster-etcd1.example.com 2001:0db8:85a3:0:0:8a2e:0370:7334
    sye aws dns-record-create my-cluster-etcd2.example.com 2001:0db8:85a3:0:0:8a2e:0370:7335
    sye aws dns-record-create my-cluster-etcd3.example.com 2001:0db8:85a3:0:0:8a2e:0370:7336

# Shutting down a cluster

To shut down a cluster, start by shutting down all machines with machine-delete:

    sye aws machine-delete my-cluster.example.com eu-central-1 core1
    sye aws machine-delete my-cluster.example.com eu-central-1 core2
    sye aws machine-delete my-cluster.example.com eu-central-1 core3
    sye aws machine-delete my-cluster.example.com eu-west-2 pitcher

Wait for the machine to be terminated. Then you can remove regions with (start with non-core regions)

    sye aws region-add my-cluster.example.com eu-west-2
    sye aws region-delete my-cluster.example.com eu-central-1

And finally delete the cluster with

    sye aws cluster-delete my-cluster.example.com

The DNS records can be deleted at any point, using dns-record-delete with the same arguments and options
as when creating the DNS records:

    sye aws dns-record-delete my-cluster-etcd1.example.com 2001:0db8:85a3:0:0:8a2e:0370:7334
    sye aws dns-record-delete my-cluster-etcd2.example.com 2001:0db8:85a3:0:0:8a2e:0370:7335
    sye aws dns-record-delete my-cluster-etcd3.example.com 2001:0db8:85a3:0:0:8a2e:0370:7336

Note that cluster-delete does NOT delete the s3-bucket with the same name as the cluster.
The reason for this is that you will then lose ownership of that bucket name.
cluster-create will reuse the same bucket if it already exists.

# Using ECR as container registry

Additionally, sye cluster on AWS is able to be deployed by using Amazon elastic container registry. An ECR works among multi-regions and it can be shared by several sye clusters.

## Create an Amazon elastic container registry
    sye aws registry-create eu-central-1

## Show all repositories of a registry in a region
    sye aws registry-show eu-central-1

## Grant read only permission to registry for a sye cluster
    sye aws registry-grant-permission https://123456789.dkr.ecr.eu-central-1.amazonaws.com/netinsight my-cluster.example.com

## Delete a registry
    sye aws registry-delete https://123456789.dkr.ecr.eu-central-1.amazonaws.com/

To set up a sye backend using ECR, you should follow the steps shown below:

    sye aws registry-create eu-central-1

    sye cluster-create --release r23.175 --internal-ipv6 https://123456789.dkr.ecr.eu-central-1.amazonaws.com/netinsight my-cluster-etcd1.example.com  my-cluster-etcd2.example.com my-cluster-etcd3.example.com

    sye aws cluster-create my-cluster.example.com ./sye-environment.tar.gz ./authorized_keys

    sye registry add-release https://123456789.dkr.ecr.eu-central-1.amazonaws.com/netinsight

    sye aws registry-grant-permission https://123456789.dkr.ecr.eu-central-1.amazonaws.com/netinsight my-cluster.example.com

You are ready to add regions and machines.

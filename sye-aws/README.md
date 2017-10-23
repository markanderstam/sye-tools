# Setup

    make release

# Example usage

Create the IAM Role and the s3-bucket:

    sye-aws cluster-create my-cluster.dev.neti.systems

Create the sye-environment.tar.gz describing the cluster:

    sye cluster-create --release r23.175 --internal-ipv6 https://docker.io/netidev my-cluster-etcd1.dev.neti.systems  my-cluster-etcd2.dev.neti.systems my-cluster-etcd3.dev.neti.systems

Now you need to add the following files to the s3-bucket my-cluster.dev.neti.systems:

- sye-environment.tar.gz in the private/ folder
- sye-cluster-join.sh in the public/ folder
- sye-cluster-leave.sh in the public/ folder
- authorized_keys in the public/ folder

Setup new regions and machines for the cluster:

    ./sye-aws region-add my-cluster.dev.neti.systems eu-central-1
    ./sye-aws region-add my-cluster.dev.neti.systems eu-west-2

    ./sye-aws machine-add my-cluster.dev.neti.systems eu-central-1 --availability-zone a --instance-type t2.large --machine-name core1 --management
    ./sye-aws machine-add my-cluster.dev.neti.systems eu-central-1 --availability-zone b --instance-type t2.large --machine-name core2
    ./sye-aws machine-add my-cluster.dev.neti.systems eu-central-1 --availability-zone c --instance-type t2.large --machine-name core3
    ./sye-aws machine-add my-cluster.dev.neti.systems eu-west-2 --instance-type t2.large --machine-name pitcher --role pitcher

    ./sye-aws cluster-show my-cluster.dev.neti.systems

Now you should add DNS names for these etcd-machines in Route53 under dev.neti.systems:

- my-cluster-etcd1.dev.neti.systems
- my-cluster-etcd2.dev.neti.systems
- my-cluster-etcd3.dev.neti.systems

# Shutting down a cluster

- Delete all ec2 instances
- Delete all VPCs
- Delete the IAM Role named "clusterId"-instance
- Delete the IAM Policy named "clusterId"-s3-read

Do NOT delete the s3-bucket if you want to use the same cluster-id again.
cluster-create can handle if the bucket already exists.

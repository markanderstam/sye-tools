# sye azure

The sye azure command can be used to setup a multi-region Sye backend on Microsoft Azure.
To allow all machines to communicate with each other across regions, the Sye backend
must use the internal-ipv4-nat method of announcing their public IP addresses to etcd.
This means that all internal traffic will be sent via the internet facing firewall on Azure.

## Current status

internal-ipv4-nat support was first added in Sye r28.0.
The `sye azure` command is currently in beta, and we will make backwards incompatible changes in the future, meaning that you may have to tear down and redeploy any sye clusters you setup with the current version of `sye azure`.

## Authentication

Authentication against Azure is performed using an interactive login. The first time you run the `sye azure` command for a cluster, it will prompt you to open a web-browser and login. When you have logged in, the generated credentials will be stored under `~/.sye/`. The stored credentials are normally only valid for one hour and then you have to login again.

## Cluster resources

All resources created for a cluster on Azure are created with the same subscription. If the account that you are logged in to has more than one subscription, then you must specify which subscription you want to use when your create the cluster.

When the cluster is created, a Resource Group named after the cluster is created, and all resources created for the cluster are placed in that Resource group.

## Firewall

Azure requires us to use public IPv4 addresses in order to run a multi-region cluster. This means all security rules must include the IP addresses of all VMs in the cluster. Security groups are set on each network interface for each machine in the cluster. Each time a machine is added or deleted the security rules for all security groups in the cluster must be rewritten. This is time consuming. Because of this there is an option to skip creating the security rules for the `machine-add` and `machine-delete` commands in order to allow setting them once with the `ensure-security-rules` command.

* All traffic is allowed from all cluster public IPs
* Port 22 is open to all VMs
* Machines with the management flag allow all TCP traffic to ports 81 and 4433.
* Machines with the frontend-balancer role allow all TCP traffic to ports 80 and 443.
* Machines with the pitcher role allow all UDP traffic to ports 2123-2130.

The internal communication in a Sye cluster is protected with [TLS Mutual Authentication](https://en.wikipedia.org/wiki/Mutual_authentication) for all services except the Log service (elasticsearch). To protect the elasticsearch service, you need to purchase an [X-pack license](https://www.elastic.co/products/x-pack) from [Elastic](https://www.elastic.co).

## Create the cluster configuration

First you need to create the `sye-environment.tar.gz` describing the cluster using the sye-command:

    sye cluster-create --release r28.0 --internal-ipv4-nat https://docker.io/netisye my-cluster-etcd1.example.com  my-cluster-etcd2.example.com my-cluster-etcd3.example.com

To run a multi-region cluster on Azure you need to specify `--internal-ipv4-nat` to tell all services
in the cluster to announce the public IP address of the machine to other instances.

The first non-option parameter (https://docker.io/netisye) is the address of a docker registry where the system can download a sye release. The command will ask you for credentials to download the release from the specified registry.

All the following parameters are addresses where the etcd-instances will listen for commands. When you run the cluster-create command, these addresses should normally not resolve to any IP addresses. The DNS records can be updated after you have deployed the machines that should run etcd and know which IP address they have.

The cluster-create command creates a file called sye-environment.tar.gz in the current directory.
This file contains all secret credentials for the cluster and should be protected
from unauthorized access.

## Create the cluster in Azure

To create the _Resource group_ and _Storage account_ in Azure for the cluster, run the following command

    sye azure cluster-create my-cluster ./sye-environment.tar.gz ./authorized_keys

This will create a cluster named "my-cluster" on Azure. The cluster name must be unique for this Azure account.

The authorized_keys file shall contain a set of ssh-keys that shall be allowed to login to all machines.
See the [man-page for sshd](<https://www.freebsd.org/cgi/man.cgi?sshd(8)>) for a specification of the authorized_keys file-format.

## Add regions

Setup new regions for the cluster:

    sye azure region-add my-cluster eastus
    sye azure region-add my-cluster westus

The region-add command will create all region-specific resources necessary to run a Sye backend. This includes a Vnet and in the future also security groups for the machines that will be created in the region.

## Add machines

    sye azure machine-add my-cluster eastus --machine-name etcd1 --storage 30 --role log --role frontend-balancer --management --skip-security-rules
    sye azure machine-add my-cluster eastus --machine-name etcd2 --storage 30 --skip-security-rules
    sye azure machine-add my-cluster eastus --machine-name etcd3 --storage 30 --skip-security-rules
    sye azure machine-add my-cluster westus --machine-name egress --role pitcher --skip-security-rules
    sye azure ensure-security-rules my-cluster

    sye azure cluster-show my-cluster

Run `sye azure machine-add --help` for a description of all parameters to machine-add.

Now you should add DNS names for the etcd-machines:

* my-cluster-etcd1.example.com
* my-cluster-etcd2.example.com
* my-cluster-etcd3.example.com

The DNS-names should point to the public IPv4 addresses for the each etcd machine.

Now wait for the DNS information to propagate and for the cluster to build itself.

When this is done, the system can be managed by pointing your browser
to the public IP address of the machine named "etcd1" (since we passed the --management parameter when we created that machine), port 81.

## Delete machines

To delete one specific machine

    sye azure machine-delete my-cluster <machine-name>

This will delete the machine, including any storage created for the machine.

# Deleting a cluster

To delete a cluster, run

    sye azure cluster-delete my-cluster

This will delete the Resource group for the Sye backend and all resources placed in that group, which includes all resources created by the sye azure commands.

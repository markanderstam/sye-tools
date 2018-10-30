# sye eks

The `sye eks` commands will create and manage [Amazon EKS](https://aws.amazon.com/eks/) Kubernetes clusters suitable for running Sye.

It should be noted that the `sye eks` command does not install Sye itself, it only creates an Kubernetes cluster suitable for running Sye on. Sye has to be installed afterwards using [Helm](https://www.helm.sh/). For instruction on how to configure and install Sye using Helm in Kubernetes, please reference the _Sye Live OTT Kubernetes Installation Guide_. 

## EKS Cluster Settings

Sye has specific requirements on the Kubernetes cluster it will run on, which are implemented by the `sye eks` command. The requirements are:

### Enhanced Networking

Sye needs high performance networking to be able to perform well. To ensure good network performance the the virtual machines must be configured with enhanced networking using single root I/O virtualization (SR-IOV). For a list of supported instance types see [Enhanced Networking on Linux](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/enhanced-networking.html)

### Public IPv4 Addresses

The streaming traffic from the egress pitchers is emitted directly from the worker nodes running the pitchers. The pitchers are running with host networking and to be able to stream they need to have public IPv4 addresses to be assigned to the primary NIC of each worker node.

### Firewall Reconfiguration

The SSP (Sye Streaming Protocol) traffic needs to be able to flow in both direction from and to the egress pitchers (and possibly also to ingress or fan-out pitchers if external SSP sources are being used).

`sye eks cluster-create` automatically opens UDP port `2123` towards all worker nodes for this purpose. 

### Ingress

Sye needs an ingress for inbound HTTPS traffic into the cluster. For this the `nginx-ingress` ingress controller can be used, see [NGINX Ingress Controller](https://kubernetes.github.io/ingress-nginx/) to learn more how it works.

`sye eks cluster-create` automatically installs the `nginx-ingress` into the `kube-system` namespace.

### Tiller (Helm)

The server side component of Helm, Tiller, is automatically installed by the `sye eks cluster-create` command. A service-account and RBAC roles are provided as well.

### DNS configuration

The ingress maps requests to different DNS names to different parts of the Sye system. For this to work the requests must be made towards the proper URLs which in turn has to be configured in the DNS. This is _not_ done by the `sye eks` commands, and needs to be managed elsewhere.

### Worker node Cloudformation template

The `sye eks` command uses a slightly modified version of the default Cloudformation template for the EKS worker nodes. The following changes have been made to the template:

* Allow streaming SSP traffic over UDP by opening up the UDP port 2123 on all worker nodes.
* Add IAM policy for performing automatic discovery of auto scaling groups.

## Amazon EKS Prerequisites

### IAM role

Before using `sye eks` to create an Amazon EKS cluster an IAM role that Kubernetes cluster can assume needs to be created. This only needs to be done one time and can be used for multiple EKS clusters.

Follow the [Getting Started with Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html) to create an Amazon EKS Service Role, such as _eksServiceRole_.

### kubectl for Amazon EKS

The `sye eks` command uses `kubectl` to setup the Kubernetes cluster after being created. This command needs to be installed together with the `aws-iam-authenticator`. They can be installed by following the _To install aws-iam-authenticator for Amazon EKS_ section in the [Getting Started with Amazon EKS](https://docs.aws.amazon.com/eks/latest/userguide/getting-started.html) guide.

## Usage Examples

### Create an EKS cluster

To create an EKS cluster named `my-cluster` in a region that has been prepared do:

```bash
sye eks cluster-create --role-name eksServiceRole --region us-west-2 \
	--name sye-eks --release 1.10 --instance-type m5.4xlarge \
	--ami ami-0a54c984b9f908c81 --count 5 --kubeconfig ~/.kube/my-cluster.yaml \
	--ssh-key my-keypair
```

This will create a cluster with 5 worker nodes and will run kubernetes `1.10`. Credentials for `kubectl`
will be stored in `~/.kube/my-cluster.yaml` (this file will be overwritten if it already exist).

The Cluster Autoscaler will be enabled for the ASG with minimum size of 1 and maximum size of 5. Specify `--min-count` to increase the minimum nodes for the ASG.

### Delete an EKS cluster

A requirement before deleting an Amazon Eks cluster is that all active services associated with a load balancer have been manually deleted.
Otherwise the VPC might be stuck with orphaned resources preventing the Cloudformation stack from being removed, see [Deleting a Cluster](https://docs.aws.amazon.com/eks/latest/userguide/delete-cluster.html) for more information.

The following command deletes an EKS cluster that has been previously created with `sye eks cluster-create`:

```bash
sye eks cluster-delete --region us-west-2 --name sye-eks
```

## Post Install Actions

### Register DNS entries

The DNS names of the Sye frontends as well as the Sye management UI needs to be registered in a DNS server. The address that the DNS entries should point to is given by:

```bash
kubectl get service -l app=nginx-ingress --namespace kube-system
```
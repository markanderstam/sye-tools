# sye aks

The `sye aks` commands will create and manage [Azure AKS](https://docs.microsoft.com/en-us/azure/aks/) Kubernetes clusters suitable for running Sye.

It should be noted that the `sye aks` command does not install Sye itself, it only creates an Kubernetes cluster suitable for running Sye on. Sye has to be installed afterwards using [Helm](https://www.helm.sh/). For instruction on how to configure and install Sye using Helm in Kubernetes, please reference the _Sye Live OTT Kubernetes Installation Guide_. 

## Prerequisites

The `sye aks` command requires that the Azure CLI, `kubectl` and `helm` is installed on the machine being used. For instructions reference:

* [Install the Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest)
* [Install and Set Up kubectl](https://kubernetes.io/docs/tasks/tools/install-kubectl/)
* [Install Helm](https://docs.helm.sh/using_helm/#install-helm)

The `sye aks` commands also requires that the Azure CLI has a valid session, use `az login` or one of the other options described in (Sign in with Azure CLI)[https://docs.microsoft.com/en-us/cli/azure/authenticate-azure-cli?view=azure-cli-latest].

## AKS Cluster Settings

Sye has specific requirements on the AKS cluster it will run on, which are implemented by the `sye aks` command. The requirements are:

### Accelerated Networking

Sye needs high performance networking to be able to perform well. To ensure good network performance the [Azure VNET CNI Plugin](https://github.com/Azure/azure-container-networking/blob/master/docs/cni.md) needs to be used, in combination with [Accelerated Networking / SR-IOV](https://docs.microsoft.com/en-us/azure/virtual-network/create-vm-accelerated-networking-cli), which is enabled automatically if the VNET CNI plugin is configured. For details see the Advanced Networking section in the [Network configuration in Azure Kubernetes Service (AKS)](https://docs.microsoft.com/en-us/azure/aks/networking-overview?view=azure-cli-latest).

### Public IPv4 Addresses

The streaming traffic from the egress pitchers is emitted directly from the worker nodes running the pitchers. The pitchers are running with host networking and to be able to stream they need to have public IPv4 addresses to be assigned to the primary NIC of each worker node.

AKS is currently not capable of configuring this automatically, and thus `sye aks` has to handle this specifically:

* The `sye aks cluster-create` command adds public IPv4 addresses to the primary IP configuration of each worker node.

### Firewall Reconfiguration

The SSP (Sye Streaming Protocol) traffic needs to be able to flow in both direction from and to the egress pitchers (and possibly also to ingress or fan-out pitchers if external SSP sources are being used).

`sye aks cluster-create` automatically opens UDP port `2123` towards all worker nodes for this purpose.

### Ingress

Sye needs an ingress for inbound HTTPS traffic into the cluster. For this the `nginx-ingress` ingress controller can be used, see [Create an HTTPS ingress controller on Azure Kubernetes Service (AKS)](https://docs.microsoft.com/en-us/azure/aks/ingress-tls).

`sye aks cluster-create` automatically installs the `nginx-ingress` into the `kube-system` namespace.

### Tiller (Helm)

The server side component of Helm, Tiller, is automatically installed by the `sye aks cluster-create` command. A service-account and RBAC roles are provided as well.

### DNS configuration

The ingress maps requests to different DNS names to different parts of the Sye system. For this to work the requests must be made towards the proper URLs which in turn has to be configured in the DNS. This is _not_ done by the `sye aks` commands, and needs to be managed elsewhere.

## Permissions

Due to the fact that Accelerated Networking is required and therefore the VNET that is to be used by the AKS cluster needs to be manually created there are permissions that needs to be created. There are two choices:

### Using an Owner account

This is the easiest solution, but it is not optimal from a security standpoint. In this solution a subscription owner creates all parts of the AKS cluster.

### Create a VNET and a Service Principal with Contributor role for the VNET

This is a better approach from a security standpoint. In this scenario a subscription owner prepares a region for Sye AKS clusters by running the `sye aks prepare-region` command. This will create a resource group, a vitrual network (VNET) and a service principal (SP). The SP is then assigned Creator permissions on the VNET which enables subscription Contributors to create AKS clusters (using the `aks create-cluster` command) that use the resources created in this step.

When using this approach the secret (password) of the SP needs to be specified both to the `sye aks prepare-region` and the `sye aks create-cluster` commands.

## Usage Examples

The below examples assumes that the default subscription is used. To specify the default subscription for the Azure CLI do:

```bash
az account set --subscription "SubscriptionID"
```

There is also the option of using the `--subscription` option to specify the subscription to use for the different `sye aks` commands.

### Prepare a region

_NOTE: This step has to be executed with Owner permissions for the Azure subscription._

To create a resource group `sye-aks`, in the location `westeurope` and with a password `EjPZQH8FXtCThvIN0kUskAStYS0I3` do:

```bash
sye aks region-prepare --resource-group sye-aks --location westeurope \
    --password EjPZQH8FXtCThvIN0kUskAStYS0I3
```

This will have been created:

* A resource group `sye-aks`
* A a VNET named `sye-aks` (same as the reource group)
* A service principal identified with `http://sye-aks-sp`
* A `Contributor` role assignment for the service principal for the VNET

### Create an AKS cluster

To create an AKS cluster named `my-cluster` in a region that has been prepared do:

```bash
sye aks cluster-create --resource-group sye-aks --location westeurope \
		--password EjPZQH8FXtCThvIN0kUskAStYS0I3 \
		--name my-cluster --release 1.11.3 \
		--size Standard_F16 --count 5 --kubeconfig ~/.kube/my-cluster.yaml
```

The cluster will have 5 `Standard_F16` worker nodes and will run kubernetes `1.11.3`. Credentials for `kubectl`
will be stored in `~/.kube/my-cluster.yaml` (this file will be overwritten if it already exist).

To find out what versions of kubernetes that is supported in a specific location do:

```bash
az aks get-versions --location westeurope --query '*[].orchestratorVersion' -o tsv
```

This will have been created:

* A subnet in the VNET created in the prepare step.
* A AKS cluster

The AKS cluster will have been modified according to the requirements of Sye (see above).

## Post Install Actions

### Register DNS entries

The DNS names of the Sye frontends as well as the Sye management UI needs to be registered in a DNS server. The address that the DNS entries should point to is given by:

```bash
kubectl get service -l app=nginx-ingress --namespace kube-system
```

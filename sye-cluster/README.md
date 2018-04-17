# sye cluster

The `sye cluster` command is used to create and maintain
a configuration file for a sye cluster.

## Usage

### Command `sye cluster create`

Create the SYE cluster configuration file:

    sye cluster create https://docker.io/netisye etcd1.example.com etcd2.example.com etcd3.example.com

The first parameter to the create command
is the url for the docker registry
that the system shall use.
All subsequent parameters are ip-addresses or dns-names
for the machines in the cluster that shall run etcd.
Note that nothing needs to respond at these addresses
and dns names do not even need to resolve
when the `sye cluster create` command is run.

If the docker registry is set up to require login,
the command will ask for a username and password.
It is also possible to supply credentials via
the environment variables `SYE_REGISTRY_USERNAME` and `SYE_REGISTRY_PASSWORD`.

The result of the `sye cluster create` command is
a file that is named `./sye-environment.tar.gz`
by default. This file contains certificates used
for internal communication in the cluster as well
as the login credentials for the docker registry
and must be protected from unauthorized access.

For more parameters, run

    sye cluster create --help

### Command `sye cluster create-certs`

Performs TLS certificate rotation tasks.
 
To rotate TLS certificates in a SYE cluster the following procedure needs
to be performed:

#### 1. Create the new root certificates

First the new TLS root certificates needs to be created:

    sye cluster create-certs ./sye-environment.tar.gz

This will result in three new configuration files being created:

1. `sye-environment-stage-1.tar.gz` \
   Configuration where the all nodes will trust both the old and the new
   root certificates. The old certificate is active and used to issue
   client and server certificates for SYE services.

2. `sye-environment-stage-2.tar.gz` \
   The old and the new root certificates are trusted and the new root
   certificate is used for issuing certs.

3. `sye-environment-stage-3.tar.gz` \
   Only the new root certificates are trusted and the new root
   certificate is used for issuing certs.

#### 2. Update the cluster with new configurations one at a time

For each of the `sye-environment-stage-<N>.tar.gz` files the following
procedure should be performed in order (i.e. first `stage-1`,
then `stage-2` and last `stage-3`):

##### Update the cluster with new configuration

Updating the cluster needs to be done using one of the command specific
for the environment at hand. For AWS it would be:

    sye aws upload-config myClusterId ./sye-environment-stage-<N>.tar.gz

and for Azure:    

    sye azure upload-config myClusterId ./sye-environment-stage-<N>.tar.gz

This is to ensure that all newly created machines (by either the scaling
or the `sye * machine-add` command) get the proper certs.

##### Update all machines with the configuration

For each machine in the cluster do (this step requires SSH access
as root to the machines):

    # Copy the sye-cluster-install-certs.sh from https://github.com/netinsight/sye-tools
    # Copy the sye-environment-stage-<N>.tar.gz to the machine
    sudo sye-cluster-install-certs.sh -f sye-environment-stage-<N>.tar.gz

#### 3. Save the new configuration as reference

The last configuration file, `sye-environment-stage-3.tar.gz` should now
be renamed and used as the new master configuration file `sye-environment.tar.gz`.

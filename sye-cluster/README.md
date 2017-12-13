# sye cluster

The `sye cluster` command is used to create a configuration file for a sye cluster.

## Usage

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

# sye single-server

The `sye single-server` command can be used to setup a Sye-backend on a single
machine for demo purposes. Note that a single-server system shall
not be used in production since it provides no redundancy.
It is also not possible to grow a single-server system
to multiple machines.

## Usage

    sye single-server eth0

This will create a single-server installation
where the management and streaming services listen on eth0.
The installation will be done from Docker Registry
with the latest available release.

If the docker registry is set up to require login
(which Docker Registry is),
the command will ask for a username and password.
It is also possible to supply credentials via
the environment variables `SYE_REGISTRY_USERNAME` and `SYE_REGISTRY_PASSWORD`.

For other installation options, run

    sye single-server --help
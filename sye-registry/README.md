# sye registry

The `sye registry` command is used to interact
with a docker registry. It takes a number
of subcommands described below.

For help on a specific subcommand, supply the argument
`--help` to the subcommand, e.g.

    sye registry add-release --help

This will describe more parameters that are not
described in this file.

## sye registry add-release

Used to upload a new sye release to a docker registry.
The command must be run from within a directory
containing an unpacked sye-release file.

    tar xzf sye ott-release_r25.44.tar.gz
    cd ott-release_r25.44
    sye registry add-release https://dockerregistry.example.com/sye

If the docker registry is set up to require login,
the command will ask for a username and password.
It is also possible to supply credentials via
the environment variables `SYE_REGISTRY_USERNAME` and `SYE_REGISTRY_PASSWORD`.

## sye registry add-images

This command is only necessary for intermediate development versions
of a sye backend.

## sye registry start

Start a local docker registry running on this machine.

    sye registry start 127.0.0.1

Takes an argument specifying the IP-address that the
registry should listen on.

## sye registry remove

Stop a local docker registry that was previously started
with `sye registry start``

    sye registry remove

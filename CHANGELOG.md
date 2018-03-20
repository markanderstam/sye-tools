# Changelog

All notable changes to this project will be documented in this file.

## [] - Unreleased

## [1.1.1] - 2018-03-20

* Fix issue downloading release metadata in sye-cluster-join.sh

## [1.1.0] - 2018-03-19

* AWS: Create and delete DNS records
* Azure: Create and delete DNS records
* Remove obsolete `cluster-create` command. Use `cluster create` instead.
* Azure: Added support for setting security groups. See [sye-azure/README.md](sye-azure/README.md) for details.
* Azure: Support for multiple profiles (`--profile`).
* Azure: Command for redeploying machines
* Fix naming of remote image on `registry add-images/add-release` in the non-ECR case.

## [1.0.0] - 2018-02-23

Initial support for multi-region clusters on Azure. See [sye-azure/README.md](sye-azure/README.md) for details.

## [0.9.9] - 2018-01-06

No code changes from 0.9.8. Re-released due to npm problems.

## [0.9.8] - 2018-01-06

* AWS: Create an EFS volume in all regions that support EFS
* AWS: Mount EFS volume into /sharedData in all machines
* AWS: Show private IP address of machines in `sye aws cluster-show`
* AWS: Support for creating ECR repositories, uploading release to them
  and using them in a cluster. Requires Sye release r26.2 or later.

## [0.9.7] - 2017-12-13

* Fix single-server installation
* Improve documentation

## [0.9.6] - 2017-12-13

* Allow single-server installations from Docker Hub

## [0.9.5] - 2017-12-01

* Split into several smaller sub-commands
* Support for Amazon ECR Container Registry
* Delete machine by name or instanceId
* Configure machines with role pitcher with sysctl
* Add a "scaling" role for machines
* Use EnableDnsHostnames to make kafka work

## [0.9.4] 2017-10-26

First public release

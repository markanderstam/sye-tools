# Changelog

All notable changes to this project will be documented in this file.

## [] - Unreleased

## [1.4.0] - 2018-10-25

* Support for building Azure AKS clusters added
* Support for building Amazon EKS clusters added

## [1.3.7] - 2018-09-27

* Increase net.core.rmem_max and wmem_max for pitchers.
* Leave rmem/wmem_default values unchanged from default numbers.

## [1.3.6] - 2018-09-14

* Azure: Accelerated networking is enabled on instance types that support it.

## [1.3.5] - 2018-09-04

* Fixed sye-azure issue where adding a new machine to a cluster would not
apply Sye custom settings.

## [1.3.4] - 2018-08-22

* Save only a single core dump at a time.
* Prevent core dumps from being cleaned from /tmp.
* Enable tcp keepalive to keep firewalls from timing out connections
  between instances.

## [1.3.3] - 2018-08-14

* Enable core dumps.
* Improve AWS API rate limit handling.
* Improve AWS cluster cleanup workflow.

## [1.3.2] - 2018-06-29

* Improve error logging when we fail to find the public ip address of a vm.

## [1.3.1] - 2018-05-10

* Pin docker to docker-17.09.1ce-1.111.amzn1 on Amazon since the old package that we pinned to has disappeared.

## [1.3.0] - 2018-04-27

* Add support for rotating certificates

## [1.2.0] - 2018-04-23

* Add commands for uploading/updating bootstrap.sh and sye-cluster-join.sh in S3/Blob
* Pin docker to 17.12.0ce to avoid problem where docker unmounts the data volume
* Use proper device name for data volume. Note: You must run sye aws/azure upload-bootstrap after upgrading to this release of sye-tools

## [1.1.3] - 2018-03-30

* Lock version of azure-arm-network to avoid https://github.com/Azure/azure-sdk-for-node/issues/2597

## [1.1.2] - 2018-03-29

* AWS: Fix issue with installing from a registry on Amazon ECR.
* Add tests for sye-cluster-join.sh
* Azure: Delete VNET when deleting region
* Azure: Login with a service principal

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

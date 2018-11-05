#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { exit } from '../lib/common'
import { createEksCluster } from '../sye-eks/lib/cluster-create'
import { deleteEksCluster } from '../sye-eks/lib/cluster-delete'

function required(options: object, name: string, optionName: string = name): string {
    if (!options[optionName]) {
        exit(`The option --${name} is required`)
    }
    return options[optionName]
}

program.description('Manage Sye-clusters on Amazon Elastic Container Service for Kubernetes (Amazon EKS)')

program
    .command('cluster-create')
    .description('Setup a new Sye cluster on Amazon EKS')
    .option('--role-name <name>', 'Amazon IAM role pre-configured with EKS permissions')
    .option('--region <name>', 'Region to install the EKS cluster in')
    .option('--name <name>', 'The name of the EKS cluster to create')
    .option('--release <version>', 'The Kubernetes version to use')
    .option('--instance-type <type>', 'Instance type for the worker nodes')
    .option('--ami <string>', 'Amazon EKS worker node AMI ID for the specified region')
    .option('--count <number>', 'The number of worker nodes to create')
    .option('--min-count [number]', 'The minimum number of worker nodes for the ASG', '1')
    .option('--kubeconfig <path>', 'Path to the kubectl config file to save credentials in')
    .option('--ssh-key <name>', 'Name of an Amazon EC2 SSH key pair used for connecting with SSH into the worker nodes')
    .action(async (options: object) => {
        try {
            await createEksCluster({
                clusterRole: required(options, 'role-name', 'roleName'),
                region: required(options, 'region'),
                clusterName: required(options, 'name'),
                kubeconfig: required(options, 'kubeconfig'),
                kubernetesVersion: required(options, 'release'),
                instanceType: required(options, 'instance-type', 'instanceType'),
                workerAmi: required(options, 'ami'),
                nodeCount: parseInt(required(options, 'count')),
                minNodeCount: parseInt(options['minCount']),
                nodeSshKey: required(options, 'ssh-key', 'sshKey'),
            })
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('cluster-delete')
    .description('Delete an existing Sye cluster on Amazon EKS')
    .option('--region <name>', 'Region where the EKS cluster was installed in')
    .option('--name <name>', 'The name of the EKS cluster to delete')
    .action(async (options: object) => {
        try {
            await deleteEksCluster({
                region: required(options, 'region'),
                clusterName: required(options, 'name'),
            })
        } catch (ex) {
            exit(ex)
        }
    })

program.command('*').action(help)

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    help()
}

function help() {
    program.outputHelp()
    exit('Use <command> -h for help on a specific command.\n')
}

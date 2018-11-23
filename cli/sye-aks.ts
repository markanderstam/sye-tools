#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { aksRegionPrepare } from '../sye-aks/lib/region-prepare'
import { createAksCluster } from '../sye-aks/lib/cluster-create'
import { exit } from '../lib/common'
import { aksRegionCleanup } from '../sye-aks/lib/region-cleanup'
import { deleteAksCluster } from '../sye-aks/lib/cluster-delete'
import { prepareClusterAutoscaler } from '../sye-aks/lib/cluster-autoscaler-prepare'
import { defaultClusterAutoscalerSpName } from '../sye-aks/lib/utils'
import { cleanupClusterAutoscaler } from '../sye-aks/lib/cluster-autoscaler-cleanup'
const debug = require('debug')('sye-aks')

function required(options: object, name: string, optionName = name, reason?: string): string {
    if (!options[optionName]) {
        exit(`The option --${name} is required ${reason}`)
    }
    return options[optionName]
}

program.description('Manage Sye-clusters on Azure Kubernetes Service (AKS)')

program
    .command('region-prepare')
    .description('Prerequisites for AKS: create a Resource group, SP and VNET')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--location <name>', 'The Azure location to create the AKS cluster in')
    .option('--password <string>', 'Password for the service principal')
    .option('--cidr [cidr]', 'CIDR to use for the virtual network', '10.100.0.0/16')
    .action(
        async (options: {
            subscription?: string
            resourceGroup: string
            location: string
            password: string
            cidr: string
        }) => {
            try {
                debug('options', options)
                await aksRegionPrepare(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    location: required(options, 'location'),
                    vnetCidr: required(options, 'cidr'),
                    servicePrincipalPassword: required(options, 'password'),
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('region-cleanup')
    .description('Cleanup resource group, SP and VNET')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .action(async (options: { subscription?: string; resourceGroup: string }) => {
        try {
            debug('options', options)
            await aksRegionCleanup(options.subscription, {
                resourceGroup: required(options, 'resource-group', 'resourceGroup'),
            })
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('cluster-create')
    .description('Setup a new sye cluster on Azure AKS')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--location <name>', 'The Azure location to create the AKS cluster in')
    .option('--name <name>', 'The name of the AKS cluster to create')
    .option('--release <version>', 'The Kubernetes version to use')
    .option('--size <type>', 'The type of VMs to use for the worker nodes')
    .option('--count <number>', 'The number of worker nodes to create')
    .option('--min-count [number]', 'The minimum number of worker nodes for the Cluster Autoscaler', '1')
    .option('--max-count [number]', 'The maximum number of worker nodes for the Cluster Autoscaler (default: <count>)')
    .option('--password <string>', 'Password for the service principal')
    .option('--kubeconfig <path>', 'Path to the kubectl config file to save credentials in')
    .option('--cidr [cidr]', 'CIDR to use for the subnet', '10.100.0.0/20')
    .option('--open-ssh-port', 'Allow SSH access to the worker nodes')
    .option('--setup-cluster-autoscaler', 'Setup the Cluster Autoscaler for this (existing) cluster')
    .option('--cluster-autoscaler-version [version]', 'The Cluster Autoscaler version to use')
    .option(
        '--autoscaler-sp-name [string]',
        `Name for the existing Cluster Autoscaler's service principal (default: ${defaultClusterAutoscalerSpName(
            '<resource-group>',
            '<name>'
        )})`
    )
    .option('--autoscaler-sp-password [string]', "Password for the existing Cluster Autoscaler's service principal")
    .action(
        async (options: {
            subscription?: string
            resourceGroup: string
            location: string
            name: string
            release: string
            size: string
            count: string
            minCount: string
            maxCount?: string
            password: string
            kubeconfig: string
            cidr: string
            setupClusterAutoscaler?: boolean
            clusterAutoscalerVersion?: string
            autoscalerSpName?: string
            autoscalerSpPassword?: string
            openSshPort?: boolean
        }) => {
            if (options.setupClusterAutoscaler) {
                required(
                    options,
                    'cluster-autoscaler-version',
                    'clusterAutoscalerVersion',
                    'for setting up the Cluster Autoscaler'
                )
                required(
                    options,
                    'autoscaler-sp-password',
                    'autoscalerSpPassword',
                    'for setting up the Cluster Autoscaler'
                )
            }
            try {
                await createAksCluster(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    location: required(options, 'location'),
                    clusterName: required(options, 'name'),
                    kubernetesVersion: required(options, 'release'),
                    vmSize: required(options, 'size'),
                    nodeCount: parseInt(required(options, 'count')),
                    minNodeCount: parseInt(options.minCount),
                    maxNodeCount: parseInt(options.maxCount || options.count),
                    servicePrincipalPassword: required(options, 'password'),
                    kubeconfig: required(options, 'kubeconfig'),
                    subnetCidr: options.cidr,
                    clusterAutoscalerVersion: options.clusterAutoscalerVersion,
                    autoscalerSpName: options.autoscalerSpName,
                    autoscalerSpPassword: options.autoscalerSpPassword,
                    openSshPort: options.openSshPort,
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('cluster-delete')
    .description('Delete an existing Sye cluster on Azure AKS')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--name <name>', 'The name of the AKS cluster to create')
    .action(async (options: { subscription?: string; resourceGroup: string; name: string }) => {
        try {
            await deleteAksCluster(options.subscription, {
                resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                clusterName: required(options, 'name'),
            })
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('cluster-autoscaler-prepare')
    .description('Create a service principal for the Cluster Autoscaler for an existing AKS cluster')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--cluster-name <name>', 'The name of the existing AKS cluster')
    .option('--password <string>', 'Password for the service principal for the cluster autoscaler')
    .action(
        async (options: { subscription?: string; resourceGroup: string; clusterName: string; password: string }) => {
            try {
                await prepareClusterAutoscaler(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    clusterName: required(options, 'cluster-name', 'clusterName'),
                    servicePrincipalPassword: required(options, 'password'),
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('cluster-autoscaler-cleanup')
    .description('Delete the service principal for the Cluster Autoscaler')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing/deleted AKS cluster')
    .option('--cluster-name <name>', 'The name of the existing/deleted AKS cluster')
    .action(async (options: { subscription?: string; resourceGroup: string; clusterName: string }) => {
        try {
            await cleanupClusterAutoscaler(options.subscription, {
                resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                clusterName: required(options, 'cluster-name', 'clusterName'),
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

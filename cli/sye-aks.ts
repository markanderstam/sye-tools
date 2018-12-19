#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { aksRegionPrepare } from '../sye-aks/lib/region-prepare'
import { createAksCluster } from '../sye-aks/lib/cluster-create'
import { exit } from '../lib/common'
import { aksRegionCleanup } from '../sye-aks/lib/region-cleanup'
import { deleteAksCluster } from '../sye-aks/lib/cluster-delete'
import { prepareClusterAutoscaler } from '../sye-aks/lib/cluster-autoscaler-prepare'
import { cleanupClusterAutoscaler } from '../sye-aks/lib/cluster-autoscaler-cleanup'
import { defaultClusterAutoscalerSpName } from '../sye-aks/lib/aks-config'
import { NodePool } from '../lib/azure/azure-session'
import { showAksCluster } from '../sye-aks/lib/show-cluster'
import { showAksRegion } from '../sye-aks/lib/show-region'
import { scaleAksCluster } from '../sye-aks/lib/cluster-scale'
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
    .option('--nodepools <json>', 'A JSON describing the nodepools to use')
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
            nodepools: string
            password: string
            kubeconfig: string
            cidr: string
            openSshPort?: boolean
            setupClusterAutoscaler?: boolean
            clusterAutoscalerVersion?: string
            autoscalerSpName?: string
            autoscalerSpPassword?: string
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
            const nodepools: NodePool[] = []
            for (const nodepoolJson of JSON.parse(options.nodepools)) {
                nodepools.push({
                    name: nodepoolJson.name,
                    count: nodepoolJson.count,
                    minCount: nodepoolJson.minCount || 1,
                    maxCount: nodepoolJson.maxCount || 0,
                    vmSize: nodepoolJson.vmSize,
                })
            }

            try {
                await createAksCluster(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    location: required(options, 'location'),
                    clusterName: required(options, 'name'),
                    kubernetesVersion: required(options, 'release'),
                    nodepools: nodepools,
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
    .command('cluster-scale')
    .description('Scale a node pool of an existing Sye cluster on Azure AKS')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--name <name>', 'The name of the AKS cluster to delete')
    .option('--nodePoolName [name]', 'The node pool to scale')
    .option('--nodePoolSize [name]', 'The new size of the node pool')
    .option('--update-public-ips', 'Also make sure all VMs has a public IP address')
    .action(
        async (options: {
            subscription?: string
            resourceGroup: string
            name: string
            nodePoolName: string
            nodePoolSize: string
            updatePublicIps: boolean
        }) => {
            try {
                await scaleAksCluster(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    clusterName: required(options, 'name'),
                    nodePoolName: required(options, 'nodePoolName'),
                    nodePoolSize: parseInt(required(options, 'nodePoolSize')),
                    updatePublicIps: options.updatePublicIps,
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
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--name <name>', 'The name of the AKS cluster to delete')
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
            await cleanupClusterAutoscaler({
                subscriptionNameOrId: options.subscription,
                resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                clusterName: required(options, 'cluster-name', 'clusterName'),
            })
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('show-region')
    .description('Show the current status of a AKS region')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('-g, --resource-group <name>', 'The resource group for the existing/deleted AKS cluster')
    .action(async (options: { subscriptionNameOrId?: string; resourceGroup: string }) => {
        try {
            required(options, 'resourceGroup')
            await showAksRegion(options)
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('show-cluster')
    .description('Show the current status of AKS clusters in AKS')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('-g, --resource-group <name>', 'The resource group for the existing/deleted AKS cluster')
    .option('-n, --cluster-name <name>', 'The name of the existing/deleted AKS cluster')
    .action(async (options: { subscriptionNameOrId?: string; resourceGroup: string; clusterName: string }) => {
        try {
            required(options, 'resourceGroup')
            required(options, 'clusterName')
            await showAksCluster(options)
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

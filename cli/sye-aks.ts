#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { aksRegionPrepare } from '../sye-aks/lib/region-prepare'
import { createAksCluster } from '../sye-aks/lib/cluster-create'
import { exit } from '../lib/common'
import { aksRegionCleanup } from '../sye-aks/lib/region-cleanup'
import { deleteAksCluster } from '../sye-aks/lib/cluster-delete'
import { showAksCluster } from '../sye-aks/lib/show-cluster'
import { showAksRegion } from '../sye-aks/lib/show-region'
import { addNodePoolToAksCluster, deleteNodePoolToAksCluster } from '../sye-aks/lib/cluster-nodepool'
import { ContainerServiceVMSizeTypes } from '@azure/arm-containerservice/src/models/index'
import * as camelcase from 'camelcase'
const debug = require('debug')('sye-aks')

function required(options: object, ...names: string[]): void {
    for (const optionName of names) {
        const name = camelcase(optionName)
        if (!options.hasOwnProperty(name)) {
            exit(`The option --${optionName} is required (${name})`)
        }
    }
}

program.description('Manage Sye-clusters on Azure Kubernetes Service (AKS)')

program
    .command('region-prepare')
    .description('Prerequisites for AKS: create a Resource group, SP and VNET')
    .option('--subscription <name or id>', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--location <name>', 'The Azure location to create the AKS cluster in')
    .option('--password <string>', 'Password for the service principal')
    .option('--cidr <cidr>', 'CIDR to use for the virtual network', '10.100.0.0/16')
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
                required(options, 'resource-group', 'location', 'cidr', 'password')
                await aksRegionPrepare(options.subscription, options)
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('region-cleanup')
    .description('Cleanup resource group, SP and VNET')
    .option('--subscription <name or id>', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .action(async (options: { subscription?: string; resourceGroup: string }) => {
        try {
            debug('options', options)
            required(options, 'resource-group')
            await aksRegionCleanup(options.subscription, options)
        } catch (ex) {
            exit(ex)
        }
    })

function checkMinMaxCount(options: { minCount: number; maxCount: number }) {
    const enableAutoScaling = options.minCount > 0 || options.maxCount > 0
    if (enableAutoScaling && (options.minCount <= 0 || options.maxCount <= 0)) {
        exit('Both --minCount and --maxCount needs to be specified for autoscaling')
    }
    return enableAutoScaling
}

program
    .command('cluster-create')
    .description('Setup a new sye cluster on Azure AKS')
    .option('--subscription <name or id>', 'The Azure subscription (optional)')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--location <name>', 'The Azure location to create the AKS cluster in')
    .option('--name <name>', 'The name of the AKS cluster to create')
    .option('--release <version>', 'The Kubernetes version to use')
    .option('--node-pool-name <name>', 'Name of the main node pool (default is main)', 'main')
    .option('--count <count>', 'The number of nodes in the nodepool', parseInt)
    .option('--vm-size <name>', 'The VM type')
    .option('--min-count <count>', 'Minimum scale for autoscaling (implies autoscaling)', parseInt, 0)
    .option('--max-count <count>', 'Maximum scale for autoscaling (implies autoscaling)', parseInt, 0)
    .option('--max-pods <number>', 'Optional max number of pods per node (30-110)', parseInt)
    .option('--password <string>', 'Password for the service principal')
    .option('--kubeconfig <path>', 'Path to the kubectl config file to save credentials in')
    .option('--cidr <cidr>', 'CIDR to use for the subnet', '10.100.0.0/20')
    .option('--open-ssh-port', 'Allow SSH access to the worker nodes')
    .option('--public-key-path <path>', 'Path to the public SSH key (default ~/.ssh/id_rsa.pub)')
    .option('--install-prometheus', 'Install Prometheus to support autoscaling')
    .action(
        async (options: {
            subscription?: string
            resourceGroup: string
            location: string
            name: string
            release: string
            nodePoolName: string
            count: number
            vmSize: ContainerServiceVMSizeTypes
            minCount: number
            maxCount: number
            maxPods: number
            password: string
            kubeconfig: string
            cidr: string
            openSshPort: boolean
            publicKeyPath: string
            installPrometheus: boolean
        }) => {
            try {
                required(
                    options,
                    'resource-group',
                    'location',
                    'name',
                    'release',
                    'count',
                    'vm-size',
                    'password',
                    'kubeconfig'
                )
                const enableAutoScaling = checkMinMaxCount(options)
                await createAksCluster({ ...options, enableAutoScaling })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('nodepool-add')
    .description('Add a VMSS node pool of an existing Sye cluster on Azure AKS')
    .option('--subscription <name or id>', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--name <name>', 'The name of the AKS cluster to delete')
    .option('--node-pool-name <name>', 'The node pool to scale')
    .option('--size <count>', 'The number of nodes in the pool', parseInt)
    .option('--vm-size <name>', 'The VM type')
    .option('--min-count <count>', 'Minimum scale for autoscaling (implies enable autoscaling)', parseInt)
    .option('--max-count <count>', 'Maximum scale for autoscaling (implies enable autoscaling)', parseInt)
    .action(
        async (options: {
            subscription?: string
            resourceGroup: string
            name: string
            nodePoolName: string
            size: number
            vmSize: string
            minCount: number
            maxCount: number
        }) => {
            try {
                required(options, 'resource-group', 'name', 'node-pool-name', 'size', 'vm-size')
                checkMinMaxCount(options)
                const enableAutoScaling = checkMinMaxCount(options)
                await addNodePoolToAksCluster({ ...options, enableAutoScaling })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('nodepool-delete')
    .description('Delete a VMSS node pool of an existing Sye cluster on Azure AKS')
    .option('--subscription <name or id>', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--name <name>', 'The name of the AKS cluster to delete')
    .option('--node-pool-name <name>', 'The node pool to scale')
    .action(async (options: { subscription?: string; resourceGroup: string; name: string; nodePoolName: string }) => {
        try {
            await deleteNodePoolToAksCluster(options.subscription, options)
        } catch (ex) {
            exit(ex)
        }
    })

program
    .command('cluster-delete')
    .description('Delete an existing Sye cluster on Azure AKS')
    .option('--subscription <name or id>', 'The Azure subscription')
    .option('--resource-group <name>', 'The resource group for the existing AKS cluster')
    .option('--name <name>', 'The name of the AKS cluster to delete')
    .action(async (options: { subscription?: string; resourceGroup: string; name: string }) => {
        try {
            required(options, 'resource-group', 'name')
            await deleteAksCluster(options.subscription, options)
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

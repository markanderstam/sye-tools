#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import {
    login,
    logout,
} from '../sye-azure/lib/cluster'
import { aksRegionPrepare } from '../sye-aks/lib/region-prepare'
import { createAksCluster } from '../sye-aks/lib/cluster-create'
import { exit } from '../lib/common'
import { aksRegionCleanup } from '../sye-aks/lib/region-cleanup'
import { deleteAksCluster } from '../sye-aks/lib/cluster-delete'
const debug = require('debug')('sye-aks')

function required(options: object, name: string, optionName: string = name): string {
    if (!options[optionName]) {
        exit(`The option --${name} is required`)
    }
    return options[optionName]
}

program.description('Manage Sye-clusters on Azure Kubernetes Service (AKS)')

program
    .command('login')
    .description('Login into Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (options: { profile?: string }) => {
        await login(options.profile).catch(exit)
    })

program
    .command('logout')
    .description('Logout from Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (options: { profile?: string }) => {
        await logout(options.profile).catch(exit)
    })

program
    .command('region-prepare')
    .description('Prerequisites for AKS: create a Resource group, SP and VNET')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in')
    .option('--location <name>', 'The Azure location to create the AKS cluster in')
    .option('--password <string>', 'Password for the service principal')
    .option('--cidr [cidr]', 'CIDR to use for the virtual network', '10.100.0.0/16')
    .action(
        async (
            options: {
                subscription?: string,
                resourceGroup: string,
                location: string,
                password: string,
                cidr: string
            }
        ) => {
            try {
                debug('options', options)
                await aksRegionPrepare(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    location: required(options, 'location'),
                    vnetCidr: required(options, 'cidr'),
                    servicePrincipalPassword: required(options, 'password')
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
    .action(
        async (
            options: {
                subscription?: string,
                resourceGroup: string
            }
        ) => {
            try {
                debug('options', options)
                await aksRegionCleanup(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )


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
    .option('--password <string>', 'Password for the service principal')
    .option('--kubeconfig <path>', 'Path to the kubectl config file to save credentials in')
    .option('--cidr [cidr]', 'CIDR to use for the subnet', '10.100.0.0/20')
    .action(
        async (
            options: {
                subscription?: string,
                resourceGroup: string,
                location: string,
                name: string,
                release: string,
                size: string,
                count: string,
                password: string,
                kubeconfig: string,
                cidr: string
            }
        ) => {
            try {
                await createAksCluster(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    location: required(options, 'location'),
                    clusterName: required(options, 'name'),
                    kubernetesVersion: required(options, 'release'),
                    vmSize: required(options, 'size'),
                    nodeCount: parseInt(required(options, 'count')),
                    servicePrincipalPassword: required(options, 'password'),
                    kubeconfig: required(options, 'kubeconfig'),
                    subnetCidr: options.cidr
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program
    .command('cluster-delete')
    .description('Setup a new sye cluster on Azure AKS')
    .option('--subscription [name or id]', 'The Azure subscription')
    .option('--resource-group <name>', 'Resource group to place the AKS cluster in', 'resourceGroup')
    .option('--name <name>', 'The name of the AKS cluster to create')
    .option('--yes', 'Do not prompt for confirmation')
    .action(
        async (
            options: {
                subscription?: string,
                resourceGroup: string,
                name: string,
            }
        ) => {
            try {
                await deleteAksCluster(options.subscription, {
                    resourceGroup: required(options, 'resource-group', 'resourceGroup'),
                    clusterName: required(options, 'name'),
                })
            } catch (ex) {
                exit(ex)
            }
        }
    )

program.command('*').action(help)

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    help()
}

function help() {
    program.outputHelp()
    exit('Use <command> -h for help on a specific command.\n')
}

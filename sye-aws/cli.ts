#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import {createCluster, deleteCluster, showResources} from './lib/cluster'
import {machineAdd, machineDelete, machineRedeploy} from './lib/machine'
import {regionAdd, regionDelete} from './lib/region'
import {consoleLog} from './lib/common'

program
    .description('Manage sye-clusters on Amazon')
    .version('1.0.0')

program
    .command('cluster-create <clusterId> <sye-environment> <authorized_keys>')
    .description('Setup a new sye cluster on Amazon')
    .action(async (clusterId, syeEnvironment, authorizedKeys) => {
        consoleLog(`Creating cluster ${clusterId}`)
        await createCluster(clusterId, syeEnvironment, authorizedKeys)
            .catch(exit)
    })

program
    .command('cluster-delete <clusterId>')
    .description('Delete a sye cluster on Amazon')
    .action(async (clusterId) => {
        consoleLog(`Deleting cluster ${clusterId}`)
        await deleteCluster(clusterId)
            .catch(exit)
    })

program
    .command('cluster-show <clusterId>')
    .description('Show all resources used by a cluster')
    .option('--raw', 'Show raw JSON format')
    .action(async (clusterId, options) => {
        await showResources(clusterId, true, options.raw)
            .catch(exit)
    })

program
    .command('region-add <cluster-id> <region>')
    .description('Setup a new region for the cluster')
    .action(async (clusterId: string, region: string) => {
        consoleLog(`Setting up region ${region} for cluster ${clusterId}`)
        await regionAdd(clusterId, region)
            .catch(exit)
        consoleLog('Done')
    })

program
    .command('region-delete <cluster-id> <region>')
    .description('Delete a region from the cluster')
    .action(async (clusterId: string, region: string) => {
        consoleLog(`Deleting region ${region} for cluster ${clusterId}`)
        await regionDelete(clusterId, region)
            .catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-add <cluster-id> <region>')
    .description('Add a new machine, i.e. ec2-instance to the cluster')
    .option('--availability-zone [zone]', 'Availability-zone for machine. Default "a"', 'a')
    .option('--machine-name [name]', 'Name of machine, defaults to amazon instance id')
    .option('--instance-type [type]', 'e.g. t2.micro', 't2.micro')
    .option('--management', 'Run cluster-join with --management parameter')
    .option('--role [role]', 'Configure machine for a specific role. Can be used multiple times. Available roles: log pitcher management',
        (role, roles) => roles.push(role) && roles, [])
    .option('--storage [size]', 'Setup a separate EBS volume for storing container data. Size in GiB', parseInt, 0)
    .action(async (clusterId: string, region: string, options: any) => {
        consoleLog(`Adding instance ${options.machineName} in region ${region} for cluster ${clusterId}`)
        await machineAdd(clusterId, region, options.availabilityZone, options.machineName, options.instanceType, options.role, options.management, options.storage)
            .catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-delete <cluster-id> <region> <instance-name>')
    .description('Delete a machine from the cluster')
    .action(async (clusterId: string, region: string, name: string) => {
        consoleLog(`Deleting instance ${name} in region ${region} for cluster ${clusterId}`)
        await machineDelete(clusterId, region, name)
            .catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-redeploy <cluster-id> <region> <instance-name>')
    .description('Redeploy an existing machine, i.e. delete a machine and attach its data volume to a new machine')
    .action(async (clusterId: string, region: string, name: string) => {
        consoleLog(`Redeploying instance ${name} in region ${region} for cluster ${clusterId}`)
        await machineRedeploy(clusterId, region, name)
            .catch(exit)
        consoleLog('Done')
    })

program
     .command('*')
     .action(help)

program
    .parse(process.argv)


if (!process.argv.slice(2).length) {
    help()
}

function help() {
    program.outputHelp()
    consoleLog('Use <command> -h for help on a specific command.\n')
    process.exit(1)
}

function exit(err) {
    consoleLog(err, true)
    process.exit(1)
}

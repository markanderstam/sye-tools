#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import {
    createCluster,
    deleteCluster,
    showResources,
    uploadBootstrap,
    uploadClusterJoin,
    uploadConfig,
} from '../sye-aws/lib/cluster'
import { machineAdd, machineDelete, machineRedeploy } from '../sye-aws/lib/machine'
import { regionAdd, regionDelete } from '../sye-aws/lib/region'
import { createRegistry, showRegistry, deleteRegistry, grantPermissionRegistry } from '../sye-aws/lib/registry'
import { createDnsRecord, deleteDnsRecord } from '../sye-aws/lib/dns'
import { consoleLog, exit } from '../lib/common'

program.description('Manage sye-clusters on Amazon')

program
    .command('dns-record-create <name> <ip>')
    .description('Create a DNS record for an IPv4 or IPv6 address')
    .option('--ttl [ttl]', 'The resource record cache time to live in seconds', (n) => parseInt(n), 300)
    .option('--wait', 'Wait for the DNS record change to be INSYNC')
    .action(async (name: string, ip: string, options: { ttl: number; wait: boolean }) => {
        consoleLog(`Creating DNS record ${name} for ip ${ip}`)
        await createDnsRecord(name, ip, options.ttl, options.wait).catch(exit)
        consoleLog('Done')
    })

program
    .command('dns-record-delete <name> <ip>')
    .description('Delete a DNS record')
    .option('--ttl [ttl]', 'The resource record cache time to live in seconds', (n) => parseInt(n), 300)
    .option('--wait', 'Wait for the DNS record change to be INSYNC')
    .action(async (name: string, ip: string, options: { ttl: number; wait: boolean }) => {
        consoleLog(`Deleting DNS record ${name} for ip ${ip}`)
        await deleteDnsRecord(name, ip, options.ttl, options.wait).catch(exit)
        consoleLog('Done')
    })

program
    .command('registry-create <region>')
    .description(`Create ECR registry for sye services`)
    .option('--prefix [prefix]', `Prefix for repositories. Default to 'netinsight'`)
    .action(async (region, options: any) => {
        consoleLog(`Creating repositories in region ${region}`)
        await createRegistry(region, options.prefix).catch(exit)
        consoleLog('Done')
    })

program
    .command('registry-show <region>')
    .description(`Show ECR registry for sye services`)
    .option('--prefix [prefix]', `Prefix for repositories. Default to 'netinsight'`)
    .option('--raw', 'Show raw JSON format')
    .action(async (region, options: any) => {
        await showRegistry(region, true, options.prefix, options.raw).catch(exit)
    })

program
    .command('registry-delete <registry-url>')
    .description(`Delete ECR registry for sye services`)
    .action(async (registryUrl) => {
        consoleLog(`Deleting registry ${registryUrl}`)
        await deleteRegistry(registryUrl).catch(exit)
        consoleLog('Done')
    })

program
    .command('registry-grant-permission <registry-url> <cluster-id>')
    .description(`Grant read only permission for cluster to access ECR registry`)
    .action(async (registryUrl, clusterId) => {
        consoleLog(`Granting permission for ${clusterId} to access ${registryUrl}`)
        await grantPermissionRegistry(registryUrl, clusterId).catch(exit)
        consoleLog('Done')
    })

program
    .command('cluster-create <cluster-id> <sye-environment> <authorized_keys>')
    .description('Setup a new sye cluster on Amazon')
    .action(async (clusterId, syeEnvironment, authorizedKeys) => {
        consoleLog(`Creating cluster ${clusterId}`)
        await createCluster(clusterId, syeEnvironment, authorizedKeys).catch(exit)
    })

program
    .command('cluster-delete <cluster-id>')
    .description('Delete a sye cluster on Amazon')
    .action(async (clusterId) => {
        consoleLog(`Deleting cluster ${clusterId}`)
        await deleteCluster(clusterId).catch(exit)
    })

program
    .command('cluster-show <cluster-id>')
    .description('Show all resources used by a cluster')
    .option('--raw', 'Show raw JSON format')
    .action(async (clusterId, options) => {
        await showResources(clusterId, true, options.raw).catch(exit)
    })

program
    .command('upload-bootstrap <cluster-id>')
    .description('Updates the bootstrap.sh file in S3')
    .action(async (clusterId: string) => {
        await uploadBootstrap(clusterId).catch(exit)
    })

program
    .command('upload-cluster-join <cluster-id>')
    .description('Updates the sye-cluster-join.sh file in S3')
    .action(async (clusterId: string) => {
        await uploadClusterJoin(clusterId).catch(exit)
    })

program
    .command('upload-config <cluster-id> <config-file>')
    .description('Updates the cluster configuration file in S3')
    .action(async (clusterId: string, configFile: string) => {
        await uploadConfig(clusterId, configFile).catch(exit)
    })

program
    .command('region-add <cluster-id> <region>')
    .description('Setup a new region for the cluster')
    .action(async (clusterId: string, region: string) => {
        consoleLog(`Setting up region ${region} for cluster ${clusterId}`)
        await regionAdd(clusterId, region).catch(exit)
        consoleLog('Done')
    })

program
    .command('region-delete <cluster-id> <region>')
    .description('Delete a region from the cluster')
    .action(async (clusterId: string, region: string) => {
        consoleLog(`Deleting region ${region} for cluster ${clusterId}`)
        await regionDelete(clusterId, region).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-add <cluster-id> <region>')
    .description('Add a new machine, i.e. ec2-instance to the cluster')
    .option('--availability-zone [zone]', 'Availability-zone for machine. Default "a"', 'a')
    .option('--machine-name [name]', 'Name of machine, defaults to amazon instance id')
    .option('--instance-type [type]', 'e.g. t2.micro', 't2.micro')
    .option('--management', 'Run cluster-join with --management parameter')
    .option(
        '--role [role]',
        'Configure machine for a specific role. Can be used multiple times. Available roles: log pitcher management scaling',
        (role, roles) => roles.push(role) && roles,
        []
    )
    .option(
        '--storage [size]',
        'Setup a separate EBS volume for storing container data. Size in GiB',
        (n) => parseInt(n),
        0
    )
    .action(async (clusterId: string, region: string, options: any) => {
        consoleLog(`Adding instance ${options.machineName} in region ${region} for cluster ${clusterId}`)
        await machineAdd(
            clusterId,
            region,
            options.availabilityZone,
            options.machineName,
            options.instanceType,
            options.role,
            options.management,
            options.storage
        ).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-delete <cluster-id> <region> <instance-name|instance-id>')
    .description('Delete a machine from the cluster')
    .action(async (clusterId: string, region: string, name: string) => {
        consoleLog(`Deleting instance ${name} in region ${region} for cluster ${clusterId}`)
        await machineDelete(clusterId, region, name).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-redeploy <cluster-id> <region> <instance-name|instance-id>')
    .description('Redeploy an existing machine, i.e. delete a machine and attach its data volume to a new machine')
    .action(async (clusterId: string, region: string, name: string) => {
        consoleLog(`Redeploying instance ${name} in region ${region} for cluster ${clusterId}`)
        await machineRedeploy(clusterId, region, name).catch(exit)
        consoleLog('Done')
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

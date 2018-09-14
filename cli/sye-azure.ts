#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import {
    login,
    logout,
    createCluster,
    deleteCluster,
    showResources,
    uploadBootstrap,
    uploadClusterJoin,
    uploadConfig,
} from '../sye-azure/lib/cluster'
import { machineAdd, machineDelete, machineRedeploy, ensureMachineSecurityRules } from '../sye-azure/lib/machine'
import { regionAdd, regionDelete } from '../sye-azure/lib/region'
import { consoleLog, exit } from '../lib/common'
import { createDnsRecord, deleteDnsRecord } from '../sye-azure/lib/dns'

program.description('Manage sye-clusters on Azure')

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
    .command('cluster-create <cluster-id> <sye-environment> <authorized_keys>')
    .description('Setup a new sye cluster on Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--subscription [name or id]', 'The Azure subscription')
    .action(
        async (
            clusterId: string,
            syeEnvironment: string,
            authorizedKeys: string,
            options: { profile?: string; subscription?: string }
        ) => {
            consoleLog(`Creating cluster ${clusterId}`)
            await createCluster(clusterId, syeEnvironment, authorizedKeys, options.profile, options.subscription).catch(
                exit
            )
        }
    )

program
    .command('cluster-delete <cluster-id>')
    .description('Delete a sye cluster on Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, options: { profile?: string }) => {
        consoleLog(`Deleting cluster ${clusterId}`)
        await deleteCluster(clusterId, options.profile).catch(exit)
    })

program
    .command('cluster-show <cluster-id>')
    .description('Show all resources used by a cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--raw', 'Show raw JSON format')
    .action(async (clusterId: string, options: { profile?: string; raw?: boolean }) => {
        await showResources(clusterId, true, options.raw, options.profile).catch(exit)
    })

program
    .command('upload-bootstrap <cluster-id>')
    .description('Updates the bootstrap.sh file in Blob')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, options: { profile?: string }) => {
        await uploadBootstrap(clusterId, options.profile).catch(exit)
    })

program
    .command('upload-cluster-join <cluster-id>')
    .description('Updates the sye-cluster-join.sh file in Blob')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, options: { profile?: string }) => {
        await uploadClusterJoin(clusterId, options.profile).catch(exit)
    })

program
    .command('upload-config <cluster-id> <config-file>')
    .description('Updates the cluster configuration file in Blob')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, configFile: string, options: any) => {
        await uploadConfig(clusterId, configFile, options.profile).catch(exit)
    })

program
    .command('region-add <cluster-id> <region>')
    .description('Setup a new region for the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, region: string, options: { profile?: string }) => {
        consoleLog(`Setting up region ${region} for cluster ${clusterId}`)
        await regionAdd(clusterId, region, options.profile).catch(exit)
        consoleLog('Done')
    })

program
    .command('region-delete <cluster-id> <region>')
    .description('Delete a region from the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, region: string, options: { profile?: string }) => {
        consoleLog(`Deleting region ${region} for cluster ${clusterId}`)
        await regionDelete(clusterId, region, options.profile).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-add <cluster-id> <region>')
    .description('Add a new machine to the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--machine-name [name]', 'Name of machine, defaults to azure instance id')
    .option('--instance-type [type]', 'e.g. Basic_A1, Standard_D5_v2', 'Standard_DS2_v2')
    .option('--management', 'Run cluster-join with --management parameter')
    .option(
        '--role [role]',
        'Configure machine for a specific role. Can be used multiple times. Available roles: log pitcher management frontend-balancer',
        (role, roles) => roles.push(role) && roles,
        []
    )
    .option(
        '--storage [size]',
        'Setup a separate data disk for storing container data. Size in GiB',
        (n) => parseInt(n),
        0
    )
    .option(
        '--skip-security-rules',
        'Skip setting security rules. Useful when adding multiple machines at the same time. You should then run the ensure-security-rules command afterwards.'
    )
    .action(
        async (
            clusterId: string,
            region: string,
            options: {
                profile?: string
                machineName: string
                instanceType: string
                management: boolean
                role: string[]
                storage: number
                skipSecurityRules?: boolean
            }
        ) => {
            consoleLog(`Adding instance ${options.machineName} in region ${region} for cluster ${clusterId}`)
            await machineAdd(
                clusterId,
                region,
                'None',
                options.machineName,
                options.instanceType,
                options.role,
                options.management,
                options.storage,
                options.skipSecurityRules,
                options.profile
            ).catch(exit)
            consoleLog('Done')
        }
    )

program
    .command('machine-delete <cluster-id> <machine-name>')
    .description('Delete a machine from the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option(
        '--skip-security-rules',
        'Skip setting security rules. Useful when deleting multiple machines at the same time. You should then run the ensure-security-rules command afterwards.'
    )
    .action(async (clusterId: string, name: string, options: { profile?: string; skipSecurityRules?: boolean }) => {
        consoleLog(`Deleting machine ${name} for cluster ${clusterId}`)
        await machineDelete(clusterId, name, options.skipSecurityRules, options.profile).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-redeploy <cluster-id> <machine-name>')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .description('Redeploy an existing machine, i.e. delete a machine and attach its data volume to a new machine')
    .action(async (clusterId: string, name: string, options: { profile?: string }) => {
        consoleLog(`Redeploying machine ${name} for cluster ${clusterId}`)
        await machineRedeploy(clusterId, name, options.profile).catch(exit)
        consoleLog('Done')
    })

program
    .command('ensure-security-rules <cluster-id>')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .description('Ensure security rules are correct for the specified cluster.')
    .action(async (clusterId: string, options: { profile?: string }) => {
        consoleLog(`Ensuring security rules for cluster ${clusterId}`)
        await ensureMachineSecurityRules(clusterId, options.profile).catch(exit)
        consoleLog('Done')
    })

program
    .command('dns-record-create <name> <ip>')
    .description('Create a DNS record for an IPv4 or IPv6 address')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--subscription [name or id]', 'The Azure subscription', process.env.AZURE_SUBSCRIPTION_ID)
    .option('--ttl [ttl]', 'The resource record cache time to live in seconds', (n) => parseInt(n), 300)
    .action(async (name: string, ip: string, options: { profile?: string; subscription?: string; ttl?: number }) => {
        consoleLog(`Creating DNS record ${name} for ip ${ip}`)
        await createDnsRecord(name, ip, options.ttl, options.profile, options.subscription).catch(exit)
        consoleLog('Done')
    })

program
    .command('dns-record-delete <name> <ip>')
    .description('Delete a DNS record')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--subscription [name or id]', 'The Azure subscription', process.env.AZURE_SUBSCRIPTION_ID)
    .action(async (name: string, ip: string, options: { profile?: string; subscription?: string }) => {
        consoleLog(`Deleting DNS record ${name} for ip ${ip}`)
        await deleteDnsRecord(name, ip, options.profile, options.subscription).catch(exit)
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

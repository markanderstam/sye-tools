#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { login, logout, createCluster, deleteCluster, showResources } from '../sye-azure/lib/cluster'
import { machineAdd, machineDelete, machineRedeploy, ensureMachineSecurityRules } from '../sye-azure/lib/machine'
import { regionAdd, regionDelete } from '../sye-azure/lib/region'
import { consoleLog, exit } from '../lib/common'
import { getProfileName } from '../sye-azure/lib/common'

program.description('Manage sye-clusters on Azure')

program
    .command('login')
    .description('Login into Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (options: any) => {
        const profile = getProfileName(options)
        await login(profile).catch(exit)
    })

program
    .command('logout')
    .description('Logout from Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (options: any) => {
        const profile = getProfileName(options)
        await logout(profile).catch(exit)
    })

program
    .command('cluster-create <clusterId> <sye-environment> <authorized_keys>')
    .description('Setup a new sye cluster on Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--subscription [name or id]', 'The Azure subscription')
    .action(async (clusterId: string, syeEnvironment: string, authorizedKeys: string, options: any) => {
        consoleLog(`Creating cluster ${clusterId}`)
        const subscription = options.subscription || process.env.AZURE_SUBSCRIPTION_ID
        const profile = getProfileName(options)
        await createCluster(profile, clusterId, syeEnvironment, authorizedKeys, subscription).catch(exit)
    })

program
    .command('cluster-delete <clusterId>')
    .description('Delete a sye cluster on Azure')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, options: any) => {
        consoleLog(`Deleting cluster ${clusterId}`)
        const profile = getProfileName(options)
        await deleteCluster(profile, clusterId).catch(exit)
    })

program
    .command('cluster-show <clusterId>')
    .description('Show all resources used by a cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option('--raw', 'Show raw JSON format')
    .action(async (clusterId: string, options: any) => {
        const profile = getProfileName(options)
        await showResources(profile, clusterId, true, options.raw).catch(exit)
    })

program
    .command('region-add <cluster-id> <region>')
    .description('Setup a new region for the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, region: string, options: any) => {
        consoleLog(`Setting up region ${region} for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await regionAdd(profile, clusterId, region).catch(exit)
        consoleLog('Done')
    })

program
    .command('region-delete <cluster-id> <region>')
    .description('Delete a region from the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .action(async (clusterId: string, region: string, options: any) => {
        consoleLog(`Deleting region ${region} for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await regionDelete(profile, clusterId, region).catch(exit)
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
    .option('--storage [size]', 'Setup a separate data disk for storing container data. Size in GiB', parseInt, 0)
    .option(
        '--skip-security-rules',
        'Skip setting security rules. Useful when adding multiple machines at the same time. You should then run the ensure-security-rules command afterwards.'
    )
    .action(async (clusterId: string, region: string, options: any) => {
        consoleLog(`Adding instance ${options.machineName} in region ${region} for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await machineAdd(
            profile,
            clusterId,
            region,
            'N/A',
            options.machineName,
            options.instanceType,
            options.role,
            options.management,
            options.storage,
            options.skipSecurityRules
        ).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-delete <cluster-id> <machine-name>')
    .description('Delete a machine from the cluster')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .option(
        '--skip-security-rules',
        'Skip setting security rules. Useful when deleting multiple machines at the same time. You should then run the ensure-security-rules command afterwards.'
    )
    .action(async (clusterId: string, name: string, options: any) => {
        consoleLog(`Deleting machine ${name} for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await machineDelete(profile, clusterId, name, options.skipSecurityRules).catch(exit)
        consoleLog('Done')
    })

program
    .command('machine-redeploy <cluster-id> <region> <instance-name|instance-id>')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .description('Redeploy an existing machine, i.e. delete a machine and attach its data volume to a new machine')
    .action(async (clusterId: string, region: string, name: string, options: any) => {
        exit('Not implemented')
        consoleLog(`Redeploying machine ${name} in region ${region} for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await machineRedeploy(profile, clusterId, region, name).catch(exit)
        consoleLog('Done')
    })

program
    .command('ensure-security-rules <cluster-id>')
    .option('--profile [name]', 'The profile used for credentials (defaults to default)')
    .description('Ensure security rules are correct for the specified cluster.')
    .action(async (clusterId: string, options: any) => {
        consoleLog(`Ensuring security rules for cluster ${clusterId}`)
        const profile = getProfileName(options)
        await ensureMachineSecurityRules(profile, clusterId).catch(exit)
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

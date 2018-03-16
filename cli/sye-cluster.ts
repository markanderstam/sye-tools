#!/usr/bin/env node

import { clusterCreate, ClusterCreateOptions, createCerts, CreateCertsOptions } from '../sye-cluster/index'
import { syeEnvironmentFile, exit } from '../lib/common'
import * as program from 'commander'

program.usage('[command] <options>')

program
    .command('create <registry-url> <etcd-ip...>')
    .description('Create a configuration file for a cluster')
    .option(
        '-o, --output <filename>',
        'configuration filename, default ./' + syeEnvironmentFile,
        './' + syeEnvironmentFile
    )
    .option('--release <release>', 'Use a specific release. Defaults to latest available in registry')
    .option('-n, --no-check', "Don't try to connect to registry.")
    .option('--internal-ipv6', 'Use IPv6 for internal communication')
    .option('--internal-ipv4-nat', 'Use IPv4 with NAT support for internal communication')
    .action(async (registryUrl: string, etcdIps: string[], options: ClusterCreateOptions) => {
        await clusterCreate(registryUrl, etcdIps, options).catch(exit)
    })

program
    .command('create-certs <config-file>')
    .description('Creates new TLS certs for certificate rotation')
    .option('-d, --output-dir <directory>', 'directory where to emit the files (default: cwd)', '.')
    .action(async (configFile: string, options: CreateCertsOptions) => {
        await createCerts(configFile, options)
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

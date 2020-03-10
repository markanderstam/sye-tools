#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import * as os from 'os'
import { resolve } from 'path'
import { clusterCreate } from '../sye-cluster/index'
import { registryAddImages, registryStart, registryRemove } from '../sye-registry/index'
import { syeEnvironmentFile, consoleLog, exit, execSync } from '../lib/common'

const VERSION = require('../../package.json').version

program.version(VERSION).description('sye-tools. See https://github.com/trulive/sye-tools')

program
    .command('registry [subcommand]', 'operate on a docker registry')
    .command('aws [subcommand]', 'operate cluster on Amazon AWS')
    .command('azure [subcommand]', 'operate cluster on Microsoft Azure')
    .command('aks [subcommand]', 'operate cluster on Microsoft Azure AKS')
    .command('eks [subcommand]', 'operate cluster on Amazon EKS')
    .command('cluster [subcommand]', 'define a sye cluster')

program
    .command('single-server <interface>')
    .description('Start a single server installation')
    .option('-l, --local-registry', 'Use a local Docker registry')
    .option(
        '-r, --registry-url <url>',
        'Use a specific external Docker registry url. Defaults to https://docker.io/netisye'
    )
    .option('--release <release>', 'Use a specific release')
    .option('--internal-ipv6', 'Use IPv6 for internal communication')
    .option('--internal-ipv4-nat', 'Use IPv4 with NAT support for internal communication')
    .option('-p, --management-port <port>', 'Start playout-management listening on this port', '81')
    .option('-t, --management-tls-port <port>', 'Start playout-management listening on this TLS port', '4433')
    .description('Install a single-server setup on this machine')
    .action(async (networkInterface: string, options: any) => {
        await singleServer(networkInterface, options)
    })

program.parse(process.argv)

async function singleServer(networkInterface: string, options: any) {
    if (options.localRegistry && options.registryUrl) {
        exit('Unable to use both local and external registry')
    }

    verifyRoot('single-server')
    configSystemForLogService()

    let managementIp: string
    try {
        managementIp = os.networkInterfaces()[networkInterface].find((v) => v.family === 'IPv4').address
    } catch (_) {}

    if (!managementIp) {
        exit('Failed to find ip address of interface ' + networkInterface)
    }

    consoleLog('\n> sye cluster-leave')
    execSync(resolve(__dirname, '..', './sye-cluster-leave.sh'))

    let registryUrl = options.registryUrl || 'https://docker.io/netisye'
    if (options.localRegistry) {
        registryUrl = 'http://127.0.0.1:5000/ott'
        consoleLog('\n> sye registry-remove')
        registryRemove()

        consoleLog('\n> sye registry-start 127.0.0.1')
        registryStart('127.0.0.1', { prefix: 'ott', file: './registry.tar' })

        consoleLog(`\n> sye registry-add-release http://127.0.0.1:5000/ott`)
        await registryAddImages('http://127.0.0.1:5000/ott', { file: './images.tar' })
    }

    const etcdIp = options.internalIpv6 ? '::1' : '127.0.0.1'

    consoleLog(
        `\n> sye cluster-create ${registryUrl} ${etcdIp} ${
            options.release ? '--release ' + options.release : ''
        } ${(options.internalIpv6 && '--internal-ipv6') || (options.internalIpv4Nat && '--internal-ipv4-nat') || ''}`
    )
    await clusterCreate(registryUrl, [etcdIp], {
        output: './' + syeEnvironmentFile,
        release: options.release,
        internalIpv6: options.internalIpv6,
        internalIpv4Nat: options.internalIpv4Nat,
    })

    consoleLog('\n> sye cluster-join')
    execSync(
        resolve(
            __dirname,
            '..',
            `./sye-cluster-join.sh --management-port ${options.managementPort} --management-tls-port ${options.managementTlsPort} --single ${networkInterface}`
        )
    )

    execSync(`rm ${syeEnvironmentFile}`)

    consoleLog(`System is starting. Will be available on http://${managementIp}:${options.managementPort}`)
}

function verifyRoot(command) {
    if (os.userInfo().uid !== 0) {
        exit(`${command} must be run as root`)
    }
}

function configSystemForLogService() {
    try {
        // Replace the value of vm.max_map_count inline or add it to the end of the file is it doesn't exist
        // reference here: https://superuser.com/questions/590630/sed-how-to-replace-line-if-found-or-append-to-end-of-file-if-not-found
        execSync(
            "sed '/^vm.max_map_count = /{h;s/=.*/= 262144/};${x;/^$/{s//vm.max_map_count = 262144/;H};x}' -i /etc/sysctl.conf"
        )
        execSync('sysctl -p')
    } catch (e) {
        consoleLog(e, true)
        exit(`Cannot set the OS parameter 'vm.max_map_count' to 262144. Exiting.`)
    }
}

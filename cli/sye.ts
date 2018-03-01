#!/usr/bin/env node

import * as program from 'commander'
import * as os from 'os'
import { resolve } from 'path'
import { clusterCreate } from '../sye-cluster/index'
import { registryAddImages, registryStart, registryRemove } from '../sye-registry/index'
import { syeEnvironmentFile, consoleLog, exit, execSync } from '../lib/common'

const VERSION = require('../../package.json').version

program.version(VERSION).description('sye-tools. See https://github.com/netinsight/sye-tools')

program
    .command('registry [subcommand]', 'operate on a docker registry')
    .command('aws [subcommand]', 'operate cluster on Amazon AWS')
    .command('azure [subcommand]', 'operate cluster on Microsoft Azure')
    .command('cluster [subcommand]', 'define a sye cluster')

program
    .command('cluster-create <registry-url> <etcd-ip...>')
    .description('Create a configuration file for a cluster')
    .option(
        '-o, --output <filename>',
        'configuration filename, default ./' + syeEnvironmentFile,
        './' + syeEnvironmentFile
    )
    .option('--release <release>', 'Use a specific release. Defaults to latest available in registry')
    .option('-n, --no-check', "Don't try to connect to registry.")
    .option('--internal-ipv6', 'Use IPv6 for internal communication')
    .action(clusterCreate)

program
    .command('single-server <interface>')
    .description('Start a single server installation')
    .option('-l, --local-registry', 'Use a local Docker registry')
    .option(
        '-r, --registry-url <url>',
        'Use a specific external Docker registry url. Default to https://docker.io/netisye'
    )
    .option('--release <release>', 'Use a specific release')
    .option('-p, --management-port <port>', 'Start playout-management listening on a port', '81')
    .option('-t, --management-tls-port <port>', 'Start playout-management listening on a TLS port', '4433')
    .description('Install a single-server setup on this machine')
    .action(singleServer)

program.parse(process.argv)

async function singleServer(networkInterface, options) {
    if (options.localRegistry && options.registryUrl) {
        exit('Unable to use both local and external registry')
    }

    verifyRoot('single-server')
    configSystemForLogService()

    let ip
    try {
        ip = os.networkInterfaces()[networkInterface].filter((v) => v.family === 'IPv4')[0].address
    } catch (e) {}

    if (!ip) {
        exit('Failed to find ip address of interface ' + networkInterface)
    }

    consoleLog('\n> sye cluster-leave')
    execSync(resolve(__dirname, '..', './sye-cluster-leave.sh'))

    let registryUrl = 'https://docker.io/netisye'
    if (options.localRegistry) {
        registryUrl = 'http://127.0.0.1:5000/ott'
        consoleLog('\n> sye registry-remove')
        registryRemove()

        consoleLog('\n> sye registry-start 127.0.0.1')
        registryStart('127.0.0.1', { prefix: 'ott', file: './registry.tar' })

        consoleLog(`\n> sye registry-add-release http://127.0.0.1:5000/ott`)
        await registryAddImages('http://127.0.0.1:5000/ott', { file: './images.tar' })
    } else if (options.registryUrl) {
        registryUrl = options.registryUrl
    }

    consoleLog(
        `\n> sye cluster-create ${registryUrl} 127.0.0.1 ${options.release ? '--release ' + options.release : ''}`
    )
    await clusterCreate(registryUrl, ['127.0.0.1'], { output: './' + syeEnvironmentFile, release: options.release })

    consoleLog('\n> sye cluster-join')
    execSync(
        resolve(
            __dirname,
            '..',
            `./sye-cluster-join.sh --management-port ${options.managementPort} --management-tls-port ${
                options.managementTlsPort
            } --single ${networkInterface}`
        )
    )

    execSync(`rm ${syeEnvironmentFile}`)

    consoleLog('System is starting. Will be available on http://' + ip + ':81')
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

#!/usr/bin/env node

const program = require('commander')
import * as cp from 'child_process'
import * as os from 'os'
import { resolve } from 'path'

const debug = require('debug')('sye')
import {clusterCreate} from '../sye-cluster/index'
import { registryAddImages, registryStart, registryRemove } from '../sye-registry/index'

program
    .version('0.0.1')
    .description('sye-tools')

program
    .command('registry [subcommand]', 'operate on a docker registry')
    .command('aws [subcommand]', 'operate cluster on Amazon AWS')
    .command('cluster [subcommand]', 'define a sye cluster')

program
    .command('cluster-create <registry-url> <etcd-ip...>')
    .description('Create a configuration file for a cluster')
    .option('-o, --output <filename>', 'configuration filename, default sye-environment.tar.gz',
        './sye-environment.tar.gz')
    .option('--release <release>', 'Use a specific release. Defaults to latest available in registry')
    .option('-n, --no-check', 'Don\'t try to connect to registry.')
    .option('--internal-ipv6', 'Use IPv6 for internal communication')
    .action( clusterCreate )

program
    .command('single-server <interface>')
    .description('Start a single server installation')
    .option('-l, --local-registry', 'Use a local Docker registry')
    .option('-r, --registry-url <url>', 'Use a specific external Docker registry url. Default to https://docker.io/netisye')
    .option('--release <release>', 'Use a specific release')
    .option('-p, --management-port <port>', 'Start playout-management listening on a port', '81')
    .option('-t, --management-tls-port <port>', 'Start playout-management listening on a TLS port', '4433')
    .description('Install a single-server setup on this machine')
    .action( singleServer )

program
  .parse(process.argv)

function singleServer( networkInterface, options ) {
    if (options.localRegistry && options.registryUrl) {
        console.log('Unable to use both local and external registry') // tslint:disable-line no-console
        process.exit(1)
    }

    verifyRoot('single-server')
    configSystemForLogService()

    let ip
    try {
        ip = os.networkInterfaces()[networkInterface].filter( v => v.family === 'IPv4')[0].address
    }
    catch(e) {}

    if(!ip) {
        console.log('Failed to find ip address of interface ' + networkInterface) // tslint:disable-line no-console
        process.exit(1)
    }

    console.log('\n> sye cluster-leave') // tslint:disable-line no-console
    execSync(resolve(__dirname, '..', './sye-cluster-leave.sh'))

    let registryUrl = 'https://docker.io/netisye'
    if (options.localRegistry) {
        registryUrl = 'http://127.0.0.1:5000/ott'
        console.log('\n> sye registry-remove') // tslint:disable-line no-console
        registryRemove()

        console.log( '\n> sye registry-start 127.0.0.1') // tslint:disable-line no-console
        registryStart('127.0.0.1', {prefix: 'ott', file: './registry.tar'})

        console.log( `\n> sye registry-add-release http://127.0.0.1:5000/ott`) // tslint:disable-line no-console
        registryAddImages('http://127.0.0.1:5000/ott', {file: './images.tar'})
    } else if (options.registryUrl) {
        registryUrl = options.registryUrl
    }

    console.log( `\n> sye cluster-create ${registryUrl} 127.0.0.1 ${options.release ? '--release ' + options.release : ''}`) // tslint:disable-line no-console
    clusterCreate(registryUrl, ['127.0.0.1'], {output: './sye-environment.tar.gz', release: options.release})

    console.log( '\n> sye cluster-join') // tslint:disable-line no-console
    execSync(resolve(__dirname, '..', `./sye-cluster-join.sh --management-port ${options.managementPort} --management-tls-port ${options.managementTlsPort} --single ${networkInterface}`))

    execSync(`rm sye-environment.tar.gz`)

    console.log('System is starting. Will be available on http://' + ip + ':81') // tslint:disable-line no-console
}

function verifyRoot(command) {
    if (os.userInfo().uid !== 0) {
        exit(1, `${command} must be run as root`)
    }
}

function configSystemForLogService() {
    try {
        // Replace the value of vm.max_map_count inline or add it to the end of the file is it doesn't exist
        // reference here: https://superuser.com/questions/590630/sed-how-to-replace-line-if-found-or-append-to-end-of-file-if-not-found
        execSync('sed \'/^vm.max_map_count = /{h;s/=.*/= 262144/};${x;/^$/{s//vm.max_map_count = 262144/;H};x}\' -i /etc/sysctl.conf')
        execSync('sysctl -p')
    } catch (e) {
        console.log(e) // tslint:disable-line no-console
        exit(1, `Cannot set the OS parameter 'vm.max_map_count' to 262144. Exiting.`)
    }
}

function execSync(cmd: string, options?: cp.ExecSyncOptions) {
    debug(cmd)
    return cp.execSync(cmd, options)
}

function exit(code, message) {
    console.log(message) // tslint:disable-line no-console
    process.exit(code)
}

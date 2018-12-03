#!/usr/bin/env node

import 'source-map-support/register'
import * as program from 'commander'
import { registryStart, registryAddImages, registryRemove } from '../sye-registry/index'
import { exit } from '../lib/common'

program.usage('[command] <options>')

program
    .command('start <ip>')
    .description('Start a docker registry on this machine')
    .option('-p, --prefix <name>', 'registry prefix name, default ott', 'ott')
    .option('-f, --file <filename>', 'file with registry image, default ./registry.tar', './registry.tar')
    .action(registryStart)

program
    .command('add-release <registry-url>')
    .description('Add a sye release to a docker registry')
    .option('-f, --file <filename>', 'file with images, default ./images.tar', './images.tar')
    .action(registryAddImages)

program
    .command('add-images <registry-url>')
    .description('Add stand-alone sye images to a docker registry')
    .option('-f, --file <filename>', 'file with images, default ./images.tar.gz', './images.tar.gz')
    .action(registryAddImages)

program
    .command('remove')
    .description('Remove the docker registry running on this machine')
    .action(registryRemove)

program.command('*').action(help)

program.parse(process.argv)

if (!process.argv.slice(2).length) {
    help()
}

function help() {
    program.outputHelp()
    exit('Use <command> -h for help on a specific command.\n')
}

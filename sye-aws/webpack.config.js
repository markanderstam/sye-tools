const webpack = require('webpack')

module.exports = {
  entry: './cli.js',
  target: 'node',
  node: {
    __dirname: false
  },
  output: {
    path: __dirname,
    filename: 'sye-aws'
  },
  plugins: [
    new webpack.BannerPlugin({
      banner: '#!/usr/bin/env node\n',
      raw: true
    })
  ]
}
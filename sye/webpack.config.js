var webpack = require('webpack')

module.exports = {
  entry: './index.js',
  target: 'node',
  output: {
    path: __dirname,
    filename: 'sye'
  },
  plugins: [
    new webpack.BannerPlugin('#!/usr/bin/env node\n',
                           { raw: true })
],
}
// frontend/api/index.js — Vercel Serverless Function entry point
'use strict';

// Force Vercel NFT bundler to include PDFKit standard font assets
require('pdfkit/standard-fonts/Helvetica');
require('pdfkit/standard-fonts/HelveticaBold');
require('pdfkit/standard-fonts/HelveticaOblique');
require('pdfkit/standard-fonts/Courier');

const app = require('../server/app');

module.exports = app;

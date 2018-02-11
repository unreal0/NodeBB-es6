

var async = require('async');

var sitemap = require('../sitemap');
var meta = require('../meta');

var sitemapController = module.exports;

sitemapController.render = (req, res, next) => {
	async.waterfall([
		(next) => {
			sitemap.render(next);
		},
		(tplData, next) => {
			req.app.render('sitemap', tplData, next);
		},
		(xml) => {
			res.header('Content-Type', 'application/xml');
			res.send(xml);
		},
	], next);
};

sitemapController.getPages = (req, res, next) => {
	sendSitemap(sitemap.getPages, res, next);
};

sitemapController.getCategories = (req, res, next) => {
	sendSitemap(sitemap.getCategories, res, next);
};

sitemapController.getTopicPage = (req, res, next) => {
	sendSitemap((callback) => {
		sitemap.getTopicPage(parseInt(req.params[0], 10), callback);
	}, res, next);
};

function sendSitemap(method, res, callback) {
	if (parseInt(meta.config['feeds:disableSitemap'], 10) === 1) {
		return callback();
	}
	async.waterfall([
		(next) => {
			method(next);
		},
		(xml) => {
			if (!xml) {
				return callback();
			}

			res.header('Content-Type', 'application/xml');
			res.send(xml);
		},
	], callback);
}


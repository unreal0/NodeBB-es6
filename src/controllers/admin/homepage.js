

var async = require('async');

var db = require('../../database');
var categories = require('../../categories');
var privileges = require('../../privileges');
var plugins = require('../../plugins');

var homePageController = module.exports;

homePageController.get = (req, res, next) => {
	async.waterfall([
		(next) => {
			db.getSortedSetRange('categories:cid', 0, -1, next);
		},
		(cids, next) => {
			privileges.categories.filterCids('find', cids, 0, next);
		},
		(cids, next) => {
			categories.getCategoriesFields(cids, ['name', 'slug'], next);
		},
		(categoryData, next) => {
			categoryData = categoryData.map(category => ({
				route: 'category/' + category.slug,
				name: 'Category: ' + category.name,
			}));

			plugins.fireHook('filter:homepage.get', { routes: [
				{
					route: 'categories',
					name: 'Categories',
				},
				{
					route: 'recent',
					name: 'Recent',
				},
				{
					route: 'top',
					name: 'Top',
				},
				{
					route: 'popular',
					name: 'Popular',
				},
			].concat(categoryData) }, next);
		},
		(data) => {
			data.routes.push({
				route: '',
				name: 'Custom',
			});

			res.render('admin/general/homepage', data);
		},
	], next);
};

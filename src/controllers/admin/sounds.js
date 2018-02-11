

var async = require('async');

var plugins = require('../../plugins');
var meta = require('../../meta');

var soundsController = module.exports;

soundsController.get = (req, res, next) => {
	var types = [
		'notification',
		'chat-incoming',
		'chat-outgoing',
	];
	async.waterfall([
		(next) => {
			meta.configs.getFields(types, next);
		},
		(settings) => {
			settings = settings || {};

			var output = {};

			types.forEach((type) => {
				var soundpacks = plugins.soundpacks.map((pack) => {
					var sounds = Object.keys(pack.sounds).map((soundName) => {
						var value = pack.name + ' | ' + soundName;
						return {
							name: soundName,
							value: value,
							selected: value === settings[type],
						};
					});

					return {
						name: pack.name,
						sounds: sounds,
					};
				});

				output[type + '-sound'] = soundpacks;
			});

			res.render('admin/general/sounds', output);
		},
	], next);
};

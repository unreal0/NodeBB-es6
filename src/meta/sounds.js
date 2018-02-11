var path = require('path');
var fs = require('fs');
var rimraf = require('rimraf');
var mkdirp = require('mkdirp');
var async = require('async');

var file = require('../file');
var plugins = require('../plugins');
var user = require('../user');
var Meta = require('../meta');

var soundsPath = path.join(__dirname, '../../build/public/sounds');
var uploadsPath = path.join(__dirname, '../../public/uploads/sounds');

var Sounds = module.exports;

Sounds.addUploads = function addUploads(callback) {
	fs.readdir(uploadsPath, (err, files) => {
		if (err) {
			if (err.code !== 'ENOENT') {
				return callback(err);
			}

			files = [];
		}

		var uploadSounds = files.reduce((prev, fileName) => {
			var name = fileName.split('.');
			if (!name.length || !name[0].length) {
				return prev;
			}
			name = name[0];
			name = name[0].toUpperCase() + name.slice(1);

			prev[name] = fileName;
			return prev;
		}, {});

		plugins.soundpacks = plugins.soundpacks.filter(pack => pack.name !== 'Uploads');
		if (Object.keys(uploadSounds).length) {
			plugins.soundpacks.push({
				name: 'Uploads',
				id: 'uploads',
				dir: uploadsPath,
				sounds: uploadSounds,
			});
		}

		callback();
	});
};

Sounds.build = function build(callback) {
	Sounds.addUploads((err) => {
		if (err) {
			return callback(err);
		}

		var map = plugins.soundpacks.map(pack => Object.keys(pack.sounds).reduce((prev, soundName) => {
			var soundPath = pack.sounds[soundName];
			prev[pack.name + ' | ' + soundName] = pack.id + '/' + soundPath;
			return prev;
		}, {}));
		map.unshift({});
		map = Object.assign.apply(null, map);

		async.series([
			(next) => {
				rimraf(soundsPath, next);
			},
			(next) => {
				mkdirp(soundsPath, next);
			},
			(cb) => {
				async.parallel([
					(next) => {
						fs.writeFile(path.join(soundsPath, 'fileMap.json'), JSON.stringify(map), next);
					},
					(next) => {
						async.each(plugins.soundpacks, (pack, next) => {
							file.linkDirs(pack.dir, path.join(soundsPath, pack.id), next);
						}, next);
					},
				], cb);
			},
		], (err) => {
			callback(err);
		});
	});
};

var keys = ['chat-incoming', 'chat-outgoing', 'notification'];

Sounds.getUserSoundMap = function getUserSoundMap(uid, callback) {
	async.parallel({
		defaultMapping: (next) => {
			Meta.configs.getFields(keys, next);
		},
		userSettings: (next) => {
			user.getSettings(uid, next);
		},
	}, (err, results) => {
		if (err) {
			return callback(err);
		}

		var userSettings = results.userSettings;
		userSettings = {
			notification: userSettings.notificationSound,
			'chat-incoming': userSettings.incomingChatSound,
			'chat-outgoing': userSettings.outgoingChatSound,
		};
		var defaultMapping = results.defaultMapping || {};
		var soundMapping = {};

		keys.forEach((key) => {
			if (userSettings[key] || userSettings[key] === '') {
				soundMapping[key] = userSettings[key] || '';
			} else {
				soundMapping[key] = defaultMapping[key] || '';
			}
		});

		callback(null, soundMapping);
	});
};

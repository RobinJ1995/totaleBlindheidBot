<?php

if(!@include("config.php")) throw new Exception("Failed to load 'config.php'");

const FILENAME_TIME = 'time';
const FILENAME_CHATID = 'chatId';
const FILENAME_DATA = 'data.json';

const QUOTES = [
	"Are we rushin' in, or are we going' sneaky-beaky like?",
	'Bingo, bango, bongo, bish, bash, bosh!',
	'Easy peasy, lemon squeezy!',
	"Grab your gear and let's go!",
	"RUSH B DON'T STOP",
];
const WINGMAN_QUOTES = [
	'Be my wingman!',
	'Be my wingman yo!',
	"Let's score some!",
];
const LONELY_WINGMAN_QUOTES = [
	"I'm a single pringle and ready to mingle!",
];

const SIX_HOURS = 60 * 60 * 6;

date_default_timezone_set('Europe/Dublin');

$members = ['@robinj1995', '@buzbuzbuz', '@gerwie', '@mercotui', '@xvilo'];
$allMembers = ['@robinj1995', '@buzbuzbuz', '@xvilo', '@gerwie', '@mercotui', '@thumbnail95', '@faperdaper', '@jpixl'];
shuffle ($members);
shuffle ($allMembers);

function sendMessage ($chatId, $text) {
    global $config;
    file_get_contents ('https://api.telegram.org/' . $config['bot-id'] . ':' . $config['bot-key'] . '/sendmessage?text=' . urlencode ($text) . '&chat_id=' . urlencode ($chatId));
}

function loadData() {
	return json_decode(file_get_contents(FILENAME_DATA), true);
}

function saveData($data) {
	file_put_contents(FILENAME_DATA, json_encode($data));
}

function loadUserPreferences($userId) {
	return loadData()['preferences'][$userId];
}

function saveUserPreferences($userId, $preferences) {
	$data = loadData();
	$data['preferences'][$userId] = $preferences;

	return saveData($data);
}

function applyUserPreferences($userId) {
	$prefs = loadUserPreferences($userId);

	foreach($prefs as $key => $value) {
		switch($key) {
			case 'timezone':
				date_default_timezone_set($value);
				break;
		}
	}
}

function starts_with ($haystack, $needle) {
    return ((FALSE !== strpos ($haystack, $needle)) && (0 == strpos ($haystack, $needle)));
}

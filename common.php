<?php
const FILENAME_TIME = 'time';
const FILENAME_CHATID = 'chatId';

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

$members = ['@robinj1995', '@buzbuzbuz', '@xvilo', '@gerwie', '@mercotui'];
$allMembers = ['@robinj1995', '@buzbuzbuz', '@xvilo', '@gerwie', '@mercotui', '@thumbnail95', '@faperdaper', '@jpixl'];
shuffle ($members);
shuffle ($allMembers);

function sendMessage ($chatId, $text)
{
        file_get_contents ('https://api.telegram.org/bot***REMOVED***/sendmessage?text=' . urlencode ($text) . '&chat_id=' . urlencode ($chatId));
}

function starts_with ($haystack, $needle)
{
        return ((FALSE !== strpos ($haystack, $needle)) && (0 == strpos ($haystack, $needle)));
}

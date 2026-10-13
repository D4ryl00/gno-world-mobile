Pod::Spec.new do |s|
  s.name           = 'Pbkdf2'
  s.version        = '1.0.0'
  s.summary        = 'PBKDF2-HMAC-SHA256 for the /pair code'
  s.description    = 'PBKDF2-HMAC-SHA256 by CommonCrypto, for the app'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

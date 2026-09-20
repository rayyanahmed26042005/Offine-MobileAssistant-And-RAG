import React from 'react';
import { Text, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useProfile } from '../utils/ProfileContext';
import Icon from 'react-native-vector-icons/MaterialIcons';

const Setting1 = ({ navigation }: { navigation: any }) => {
  const { logout } = useProfile();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
          <Icon name="arrow-back" size={24} color="#E5E7EB" />
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 32 }} />
      </View>

      <View style={styles.content}>
        <TouchableOpacity
          style={styles.modelCard}
          onPress={async () => {
            await logout();
            // Navigation to ProfileSelect happens automatically via App.tsx conditional rendering
          }}
        >
          <Text style={styles.modelName}>Switch Profile</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
};

export default Setting1;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B0F19', // Matches ChatScreen dark tone
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1F2937',
    backgroundColor: '#101626',
  },
  backButton: {
    padding: 4,
  },
  title: {
    fontSize: 20,
    color: 'grey',
    fontWeight: 'bold',
    fontFamily: 'sans-serif',
  },
  content: {
    padding: 20,
  },
  modelCard: {
    backgroundColor: '#1E293B',
    padding: 15,
    borderRadius: 12,
    marginBottom: 15,
    alignItems: 'center',
  },
  modelName: {
    color: '#ffffff',
    fontSize: 18,
  },
});
